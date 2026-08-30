import { parseLinkHeader } from "@web3-storage/parse-link-header";
import type { RefObject } from "react";
import { api, bearer } from "@/lib/api";
import type { StreamStatus } from "@/lib/types";
import { type ChatConnection, createChatConnection } from "@/lib/webrtc/chat";

const SSE_REL = "urn:ietf:params:whep:ext:core:server-sent-events";

/**
 * How long ICE may sit in "disconnected" before the connection is written off.
 * A Wi-Fi roam or a NAT rebind usually recovers on its own within a couple of
 * seconds, and letting it is far cheaper than renegotiating from scratch.
 */
const ICE_DISCONNECT_GRACE_MS = 4_000;

export class WhepError extends Error {}

/** A live WHEP session: the peer connection plus its SSE channel. */
export interface WhepConnection {
  /** Closes the peer connection and the SSE channel. Safe to call repeatedly. */
  close(): void;
}

export interface WhepHandlers {
  videoRef: RefObject<HTMLVideoElement | null>;
  onStreamStatus(status: StreamStatus): void;
  /** The peer connection reached "connected" and media is flowing. */
  onConnected(): void;
  /**
   * The session is gone and has already been torn down. The caller decides
   * whether and when to establish a new one; it is called at most once.
   */
  onDisconnected(): void;
  /** When provided, a `bb-chat-v1` chat connection is opened and handed back. */
  onChatChannel?(connection: ChatConnection): void;
}

function stopVideoTrack(video: HTMLVideoElement): void {
  const stream = video.srcObject;
  if (stream instanceof MediaStream) {
    stream.getTracks().forEach((track) => track.stop());
  }
}

/**
 * Performs the WHEP offer/answer exchange against `POST /api/whep` and wires the
 * stream's Server-Sent Events channel. Returns a handle that tears both down.
 *
 * Note: WHEP sends the raw stream key in the bearer header (unlike WHIP, which
 * base64-encodes it). The backend accepts both.
 */
export async function setupWhepConnection(
  streamKey: string,
  handlers: WhepHandlers,
): Promise<WhepConnection> {
  const video = handlers.videoRef.current;
  if (video === null) {
    throw new WhepError("Video element ref is null");
  }

  stopVideoTrack(video);
  video.srcObject = null;

  const peerConnection = new RTCPeerConnection();
  let eventSource: EventSource | null = null;
  let iceGraceTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    clearTimeout(iceGraceTimer);
    eventSource?.close();
    peerConnection.close();
  };

  // Tears the session down and reports it once, so the caller can retry.
  const disconnect = () => {
    if (closed) {
      return;
    }
    close();
    handlers.onDisconnected();
  };

  try {
    peerConnection.addTransceiver("audio", { direction: "recvonly" });
    peerConnection.addTransceiver("video", { direction: "recvonly" });

    // Open the chat data channel before negotiation so the backend binds it.
    if (handlers.onChatChannel) {
      handlers.onChatChannel(createChatConnection(peerConnection));
    }

    const remoteStream = new MediaStream();
    peerConnection.ontrack = (event: RTCTrackEvent) => {
      remoteStream.addTrack(event.track);
      const currentVideo = handlers.videoRef.current;
      if (currentVideo) {
        currentVideo.srcObject = remoteStream;
      }
      event.track.onended = () => remoteStream.removeTrack(event.track);
    };

    peerConnection.addEventListener("connectionstatechange", () => {
      switch (peerConnection.connectionState) {
        case "connected":
          clearTimeout(iceGraceTimer);
          iceGraceTimer = undefined;
          handlers.onConnected();
          return;
        case "disconnected":
          // Transient by nature — give ICE a chance to recover before
          // renegotiating.
          iceGraceTimer ??= setTimeout(disconnect, ICE_DISCONNECT_GRACE_MS);
          return;
        case "failed":
        case "closed":
          disconnect();
          return;
        default:
          return;
      }
    });

    const offer = await peerConnection.createOffer({ iceRestart: true });
    if (offer.sdp) {
      // Force stereo Opus playback.
      offer.sdp = offer.sdp.replace("useinbandfec=1", "useinbandfec=1;stereo=1");
    }
    await peerConnection.setLocalDescription(offer);

    const response = await api.raw("/whep", {
      method: "POST",
      headers: {
        Authorization: bearer(streamKey),
        "Content-Type": "application/sdp",
      },
      body: offer.sdp ?? "",
      responseType: "text",
    });

    const link = parseLinkHeader(response.headers.get("Link"));
    if (!link) {
      throw new WhepError("Missing Link header on WHEP response");
    }

    const sseUrl = link[SSE_REL]?.url;
    if (sseUrl) {
      eventSource = new EventSource(sseUrl);
      wireEventSource(eventSource, handlers, disconnect);
    }

    await peerConnection.setRemoteDescription({
      type: "answer",
      sdp: response._data ?? "",
    });
  } catch (error) {
    close();
    throw error;
  }

  return { close };
}

function wireEventSource(
  eventSource: EventSource,
  handlers: WhepHandlers,
  onSessionGone: () => void,
): void {
  eventSource.onerror = () => {
    // A dropped connection leaves readyState at CONNECTING and EventSource
    // retries by itself; closing it here would throw that recovery away. Only a
    // server rejection reaches CLOSED, and since the URL is scoped to this WHEP
    // session, that means the session no longer exists.
    if (eventSource.readyState === EventSource.CLOSED) {
      onSessionGone();
    }
  };

  eventSource.addEventListener("status", (event: MessageEvent<string>) => {
    handlers.onStreamStatus(JSON.parse(event.data) as StreamStatus);
  });
}
