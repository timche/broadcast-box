/**
 * Live-stream status as delivered by the SSE `status` event and the
 * `GET /api/status?key=` single-stream response.
 */
export interface StreamStatus {
  streamKey: string;
  motd: string;
  viewers: number;
  isOnline: boolean;
}

export interface VideoTrack {
  rid: string;
  bitrate: number;
  packetsReceived: number;
  packetsDropped: number;
  lastKeyframe: string;
}

export interface AudioTrack {
  rid: string;
  packetsReceived: number;
  packetsDropped: number;
}

export interface WhepSession {
  id: string;
  audioLayerCurrent: string;
  audioTimestamp: number;
  audioPacketsWritten: number;
  audioSequenceNumber: number;
  videoLayerCurrent: string;
  videoTimestamp: number;
  videoBitrate: number;
  videoPacketsDropped: number;
  videoPacketsWritten: number;
  videoSequenceNumber: number;
}

/**
 * Full public stream record from `GET /api/status` (array form). The admin
 * `GET /api/admin/status` endpoint returns the same shape but also includes
 * private streams.
 */
export interface StatusResult {
  streamKey: string;
  isPublic: boolean;
  motd: string;
  streamStart: string;
  videoTracks: VideoTrack[];
  audioTracks: AudioTrack[];
  sessions: WhepSession[];
}

/** Reserved-profile record from `GET /api/admin/profiles` (includes the token). */
export interface AdminProfile {
  streamKey: string;
  token: string;
  isPublic: boolean;
  motd: string;
}

/** Payload of the SSE `currentLayers` event. */
export interface CurrentLayersMessage {
  id: string;
  audioLayerCurrent: string;
  audioTimestamp: number;
  audioPacketsWritten: number;
  audioSequenceNumber: number;
  videoLayerCurrent: string;
  videoTimestamp: number;
  videoPacketsWritten: number;
  videoSequenceNumber: number;
}

/** Payload of the SSE `layers` event, keyed by mediaId ("1" video, "2" audio). */
export interface LayersMessagePayload {
  [mediaId: string]: { layers: Array<{ encodingId: string }> } | undefined;
}

export type StreamState = "Loading" | "Playing" | "Offline" | "Error";
