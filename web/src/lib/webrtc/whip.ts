import { parseLinkHeader } from "@web3-storage/parse-link-header";
import { api, base64Bearer } from "@/lib/api";

const SSE_REL = "urn:ietf:params:whep:ext:core:server-sent-events";
const SIMULCAST_PREFIX = "Web";

export class WhipError extends Error {}

/**
 * WHIP gives a broadcaster one field, so the stream password shares it with the
 * stream key as `<password>:<streamKey>`. The server splits on the last colon,
 * which is why a password may contain one and a stream key may not.
 *
 * An empty password sends the stream key alone, exactly as before, so a server
 * with no stream password configured is unaffected.
 */
export function buildPublishToken(streamKey: string, streamPassword: string): string {
  return streamPassword === "" ? streamKey : `${streamPassword}:${streamKey}`;
}

/**
 * Adds the send-only audio/video transceivers for a publish session, with
 * simulcast encodings on browsers that support them (skipped on Firefox).
 */
export function addPublishTransceivers(
  peerConnection: RTCPeerConnection,
  audioTrack: MediaStreamTrack | null,
  videoTrack: MediaStreamTrack | null,
): void {
  peerConnection.addTransceiver(audioTrack ?? "audio", { direction: "sendonly" });

  const isFirefox = navigator.userAgent.toLowerCase().includes("firefox");
  peerConnection.addTransceiver(videoTrack ?? "video", {
    direction: "sendonly",
    sendEncodings: isFirefox
      ? undefined
      : [
          { rid: `${SIMULCAST_PREFIX}High` },
          { rid: `${SIMULCAST_PREFIX}Mid`, scaleResolutionDownBy: 2 },
          { rid: `${SIMULCAST_PREFIX}Low`, scaleResolutionDownBy: 4 },
        ],
  });
}

/**
 * Performs the WHIP offer/answer exchange against `POST /api/whip`.
 * Returns the stream's SSE `EventSource` (parsed from the `Link` header), if any.
 * Throws {@link WhipError} when the endpoint does not return `201 Created`.
 */
export async function negotiateWhip(
  peerConnection: RTCPeerConnection,
  streamKey: string,
  streamPassword: string,
): Promise<EventSource | null> {
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  const response = await api.raw("/whip", {
    method: "POST",
    body: offer.sdp ?? "",
    headers: {
      Authorization: base64Bearer(buildPublishToken(streamKey, streamPassword)),
      "Content-Type": "application/sdp",
    },
    responseType: "text",
  });

  if (response.status !== 201) {
    throw new WhipError(`WHIP endpoint returned ${response.status}, expected 201`);
  }

  const link = parseLinkHeader(response.headers.get("Link"));
  const sseUrl = link?.[SSE_REL]?.url;
  const eventSource = sseUrl ? new EventSource(sseUrl) : null;

  await peerConnection.setRemoteDescription({
    type: "answer",
    sdp: response._data ?? "",
  });

  return eventSource;
}
