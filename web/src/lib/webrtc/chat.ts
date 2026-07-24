/**
 * Client side of the `bb-chat-v1` WebRTC data-channel chat protocol.
 *
 * The peer (WHIP publisher or WHEP viewer) opens the data channel; the Go
 * backend (`internal/webrtc/chatdc`) binds it, replays history, and relays
 * messages to every peer subscribed to the same stream key.
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

/** Cap the in-memory backlog so long-running streams don't grow unbounded. */
const MAX_MESSAGES = 500;

export interface ChatSnapshot {
  messages: ChatMessage[];
  status: ChatStatus;
}

/** Immutable snapshot used when there is no active connection. */
export const DISCONNECTED_SNAPSHOT: ChatSnapshot = { messages: [], status: "disconnected" };

function createClientMsgId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Owns a chat data channel and its buffered state.
 *
 * Listeners are attached synchronously in the constructor — before the channel
 * can open — so the one-shot `chat.connected` handshake and the history replay
 * are never missed by a late React subscription (the bug that left viewers
 * stuck on "connecting"). Consumers read the buffered {@link getSnapshot} and
 * {@link subscribe} to updates.
 */
export class ChatConnection {
  readonly channel: RTCDataChannel;
  private snapshot: ChatSnapshot = { messages: [], status: "connecting" };
  private readonly listeners = new Set<() => void>();

  constructor(peerConnection: RTCPeerConnection) {
    this.channel = peerConnection.createDataChannel(CHAT_DATA_CHANNEL_LABEL);
    this.channel.addEventListener("open", this.handleOpen);
    this.channel.addEventListener("close", this.handleClose);
    this.channel.addEventListener("error", this.handleError);
    this.channel.addEventListener("message", this.handleMessage);
  }

  getSnapshot = (): ChatSnapshot => this.snapshot;

  subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  };

  send(text: string, displayName: string): boolean {
    if (this.channel.readyState !== "open") {
      return false;
    }
    const trimmedText = text.trim();
    const trimmedName = displayName.trim();
    if (trimmedText.length < 1 || trimmedText.length > MAX_MESSAGE_LENGTH) {
      return false;
    }
    if (trimmedName.length < 1 || trimmedName.length > MAX_DISPLAY_NAME_LENGTH) {
      return false;
    }

    const payload: ChatSendPayload = {
      type: "chat.send",
      clientMsgId: createClientMsgId(),
      text: trimmedText,
      displayName: trimmedName,
    };

    try {
      this.channel.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  private emit(next: Partial<ChatSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    this.listeners.forEach((listener) => listener());
  }

  private setStatus(status: ChatStatus): void {
    if (this.snapshot.status !== status) {
      this.emit({ status });
    }
  }

  private append(message: ChatMessage): void {
    if (this.snapshot.messages.some((existing) => existing.id === message.id)) {
      return;
    }
    const messages = [...this.snapshot.messages, message];
    this.emit({
      messages:
        messages.length > MAX_MESSAGES ? messages.slice(messages.length - MAX_MESSAGES) : messages,
    });
  }

  private handleOpen = (): void => {
    this.setStatus("connecting"); // Wait for the `chat.connected` ack.
  };

  private handleClose = (): void => {
    this.setStatus("disconnected");
  };

  private handleError = (): void => {
    this.setStatus("error");
  };

  private handleMessage = (event: MessageEvent<string>): void => {
    let payload: ChatInbound;
    try {
      payload = JSON.parse(event.data) as ChatInbound;
    } catch {
      return;
    }

    switch (payload.type) {
      case "chat.connected":
        this.setStatus("connected");
        break;
      case "chat.history":
        payload.events.forEach((entry) => this.append(entry.message));
        break;
      case "chat.message":
        this.append(payload.message);
        break;
      case "chat.error":
        this.setStatus("error");
        break;
      // `chat.ack` needs no handling: the sent message echoes back via `chat.message`.
    }
  };
}

/**
 * Creates the chat connection on a peer connection. Must be called before the
 * SDP offer is created so the channel is part of the negotiation.
 */
export function createChatConnection(peerConnection: RTCPeerConnection): ChatConnection {
  return new ChatConnection(peerConnection);
}
