import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ChatInbound,
  type ChatMessage,
  type ChatSendPayload,
  type ChatStatus,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_MESSAGE_LENGTH,
} from "@/lib/webrtc/chat";

/** Cap the in-memory backlog so long-running streams don't grow unbounded. */
const MAX_MESSAGES = 500;

function createClientMsgId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Subscribes to a `bb-chat-v1` data channel: tracks connection status and the
 * message backlog, and exposes {@link sendMessage}. The channel is created by
 * the broadcaster and passed in once negotiated; `null` means "not connected".
 */
export function useChat(channel: RTCDataChannel | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("disconnected");
  const channelRef = useRef<RTCDataChannel | null>(null);

  useEffect(() => {
    channelRef.current = channel;
    if (channel === null) {
      setMessages([]);
      setStatus("disconnected");
      return;
    }

    setMessages([]);
    setStatus("connecting");

    const append = (message: ChatMessage) => {
      setMessages((current) => {
        if (current.some((existing) => existing.id === message.id)) {
          return current;
        }
        const next = [...current, message];
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
      });
    };

    const onOpen = () => setStatus("connecting"); // Wait for the `chat.connected` ack.
    const onClose = () => setStatus("disconnected");
    const onError = () => setStatus("error");
    const onMessage = (event: MessageEvent<string>) => {
      let payload: ChatInbound;
      try {
        payload = JSON.parse(event.data) as ChatInbound;
      } catch {
        return;
      }

      switch (payload.type) {
        case "chat.connected":
          setStatus("connected");
          break;
        case "chat.history":
          payload.events.forEach((entry) => append(entry.message));
          break;
        case "chat.message":
          append(payload.message);
          break;
        case "chat.error":
          setStatus("error");
          break;
        // `chat.ack` needs no handling: the sent message echoes back via `chat.message`.
      }
    };

    channel.addEventListener("open", onOpen);
    channel.addEventListener("close", onClose);
    channel.addEventListener("error", onError);
    channel.addEventListener("message", onMessage);

    return () => {
      channel.removeEventListener("open", onOpen);
      channel.removeEventListener("close", onClose);
      channel.removeEventListener("error", onError);
      channel.removeEventListener("message", onMessage);
    };
  }, [channel]);

  const sendMessage = useCallback((text: string, displayName: string): boolean => {
    const channel = channelRef.current;
    if (channel === null || channel.readyState !== "open") {
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
      channel.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { messages, status, sendMessage };
}
