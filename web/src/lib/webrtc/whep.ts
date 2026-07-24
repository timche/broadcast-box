import { parseLinkHeader } from "@web3-storage/parse-link-header";
import type { RefObject } from "react";
import { api, bearer } from "@/lib/api";
import type { StreamStatus } from "@/lib/types";
import { type ChatConnection, createChatConnection } from "@/lib/webrtc/chat";

const SSE_REL = "urn:ietf:params:whep:ext:core:server-sent-events";

export class WhepError extends Error {}

export interface WhepHandlers {
  videoRef: RefObject<HTMLVideoElement | null>;
  onStreamStatus(status: StreamStatus): void;
  onStreamRestart(): void;
  onOffline(): void;
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
 * stream's Server-Sent Events channel (status / streamStart). Returns the
 * negotiated peer connection.
 *
 * Note: WHEP sends the raw stream key in the bearer header (unlike WHIP, which
 * base64-encodes it). The backend accepts both.
 */
export async function setupWhepConnection(
  streamKey: string,
  handlers: WhepHandlers,
): Promise<RTCPeerConnection> {
  const video = handlers.videoRef.current;
  if (video === null) {
    throw new WhepError("Video element ref is null");
  }

  stopVideoTrack(video);
  video.srcObject = null;

  const peerConnection = new RTCPeerConnection();
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
    wireEventSource(new EventSource(sseUrl), peerConnection, handlers);
  }

  await peerConnection.setRemoteDescription({
    type: "answer",
    sdp: response._data ?? "",
  });

  return peerConnection;
}

function wireEventSource(
  eventSource: EventSource,
  peerConnection: RTCPeerConnection,
  handlers: WhepHandlers,
): void {
  eventSource.onerror = () => {
    eventSource.close();
    handlers.onOffline();
  };

  eventSource.addEventListener("streamStart", () => {
    eventSource.close();
    peerConnection.close();
    handlers.onStreamRestart();
  });

  eventSource.addEventListener("status", (event: MessageEvent<string>) => {
    handlers.onStreamStatus(JSON.parse(event.data) as StreamStatus);
  });
}
