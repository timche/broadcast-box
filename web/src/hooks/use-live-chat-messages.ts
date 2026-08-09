import { useEffect, useRef } from "react";
import type { ChatConnection, ChatMessage } from "@/lib/webrtc/chat";

/**
 * Calls `onMessage` for every chat message relayed to the given connections.
 * Subscribes to the connections rather than the chat panel, so it keeps
 * reporting while chat is closed, and skips the backlog replayed on join.
 *
 * The handler is read fresh per message, so it can close over current state
 * without resubscribing.
 */
export function useLiveChatMessages(
  connections: Record<string, ChatConnection | null>,
  onMessage: (message: ChatMessage, streamKey: string) => void,
): void {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const unsubscribes = Object.entries(connections).map(([streamKey, connection]) =>
      connection?.subscribeToLiveMessages((message) => onMessageRef.current(message, streamKey)),
    );

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [connections]);
}
