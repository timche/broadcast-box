/**
 * Client side of the `bb-chat-v1` WebRTC data-channel chat protocol.
 *
 * The publisher (WHIP) opens the data channel; the Go backend
 * (`internal/webrtc/chatdc`) binds it, replays history, and relays messages to
 * every peer subscribed to the same stream key.
 */

export const CHAT_DATA_CHANNEL_LABEL = "bb-chat-v1";

export interface ChatMessage {
  id: string;
  ts: number;
  text: string;
  displayName: string;
}

export type ChatStatus = "connecting" | "connected" | "disconnected" | "error";

/** Message the client sends to the backend. */
export interface ChatSendPayload {
  type: "chat.send";
  clientMsgId: string;
  text: string;
  displayName: string;
}

type ChatHistoryEvent = { type: "message"; message: ChatMessage };

/** Messages the backend sends to the client. */
export type ChatInbound =
  | { type: "chat.connected" }
  | { type: "chat.history"; events: ChatHistoryEvent[] }
  | { type: "chat.message"; eventId: number; message: ChatMessage }
  | { type: "chat.ack"; clientMsgId: string }
  | { type: "chat.error"; error: string; clientMsgId?: string };

/** Matches the backend validation in `chatdc.go`. */
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_DISPLAY_NAME_LENGTH = 80;

/**
 * Creates the chat data channel on a publish peer connection. Must be called
 * before the WHIP offer is created so the channel is part of the negotiation.
 */
export function createChatDataChannel(peerConnection: RTCPeerConnection): RTCDataChannel {
  return peerConnection.createDataChannel(CHAT_DATA_CHANNEL_LABEL);
}
