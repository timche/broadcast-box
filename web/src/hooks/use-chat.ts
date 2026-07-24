import { useCallback, useSyncExternalStore } from "react";
import { type ChatConnection, DISCONNECTED_SNAPSHOT } from "@/lib/webrtc/chat";

const noopSubscribe = (): (() => void) => () => {};
const getDisconnectedSnapshot = () => DISCONNECTED_SNAPSHOT;

/**
 * Reads a {@link ChatConnection}'s buffered status and message backlog and
 * exposes {@link sendMessage}. The connection buffers events from the moment it
 * is created, so subscribing here (even after the channel opened) still yields
 * the current status and full history. `null` means "not connected".
 */
export function useChat(connection: ChatConnection | null) {
  const snapshot = useSyncExternalStore(
    connection ? connection.subscribe : noopSubscribe,
    connection ? connection.getSnapshot : getDisconnectedSnapshot,
  );

  const sendMessage = useCallback(
    (text: string, displayName: string): boolean => connection?.send(text, displayName) ?? false,
    [connection],
  );

  return { messages: snapshot.messages, status: snapshot.status, sendMessage };
}
