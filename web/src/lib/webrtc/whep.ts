import { parseLinkHeader } from "@web3-storage/parse-link-header";
import { ofetch } from "ofetch";
import type { RefObject } from "react";
import { api, bearer } from "@/lib/api";
import type { CurrentLayersMessage, LayersMessagePayload, StreamStatus } from "@/lib/types";

const LAYER_REL = "urn:ietf:params:whep:ext:core:layer";
const SSE_REL = "urn:ietf:params:whep:ext:core:server-sent-events";

export class WhepError extends Error {}

export interface WhepHandlers {
  videoRef: RefObject<HTMLVideoElement | null>;
  onStreamStatus(status: StreamStatus): void;
  onLayers(audioLayers: string[], videoLayers: string[]): void;
  onCurrentLayers(layers: CurrentLayersMessage): void;
  onLayerEndpoint(endpoint: string): void;
  onStreamRestart(): void;
  onOffline(): void;
}

function stopVideoTrack(video: HTMLVideoElement): void {
  const stream = video.srcObject;
  if (stream instanceof MediaStream) {
    stream.getTracks().forEach((track) => track.stop());
  }
}

/**
 * Performs the WHEP offer/answer exchange against `POST /api/whep` and wires the
 * stream's Server-Sent Events channel (status / layers / currentLayers /
 * streamStart). Returns the negotiated peer connection.
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
  video.muted = true;
  video.srcObject = null;

  const peerConnection = new RTCPeerConnection();
  peerConnection.addTransceiver("audio", { direction: "recvonly" });
  peerConnection.addTransceiver("video", { direction: "recvonly" });

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

  const layerUrl = link[LAYER_REL]?.url;
  if (layerUrl) {
    handlers.onLayerEndpoint(layerUrl);
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

  eventSource.addEventListener("currentLayers", (event: MessageEvent<string>) => {
    handlers.onCurrentLayers(JSON.parse(event.data) as CurrentLayersMessage);
  });

  eventSource.addEventListener("layers", (event: MessageEvent<string>) => {
    const parsed = JSON.parse(event.data) as LayersMessagePayload;
    const videoLayers = parsed["1"]?.layers.map((layer) => layer.encodingId) ?? [];
    const audioLayers = parsed["2"]?.layers.map((layer) => layer.encodingId) ?? [];
    handlers.onLayers(audioLayers, videoLayers);
  });
}

/**
 * Switches the active simulcast layer via `POST <layerEndpoint>`. The endpoint
 * is the absolute `/api/layer/<id>` path from the WHEP `Link` header, so it is
 * called directly (not through the `/api` baseURL client).
 */
export async function selectLayer(
  layerEndpoint: string,
  mediaId: "1" | "2",
  encodingId: string,
): Promise<void> {
  await ofetch(layerEndpoint, {
    method: "POST",
    body: { mediaId, encodingId },
  });
}
