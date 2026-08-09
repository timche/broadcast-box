import { useEffect, useRef } from "react";
import { playAlertSound } from "@/lib/alert-sounds";
import { getSettings } from "@/lib/settings";
import type { ChatConnection } from "@/lib/webrtc/chat";

/**
 * Blips for every chat message relayed to the given connections, provided the
 * setting is on. Lives outside the chat panel on purpose — the alert is most
 * useful precisely when chat is closed.
 *
 * `getLocalDisplayName` is read per message (the viewer can rename themselves
 * mid-conversation) and keeps your own echo silent. The backend has no notion
 * of "sent by me", so someone chatting under your name is silent too.
 */
export function useChatMessageAlert(
  connections: Record<string, ChatConnection | null>,
  getLocalDisplayName: () => string,
): void {
  const getLocalDisplayNameRef = useRef(getLocalDisplayName);
  getLocalDisplayNameRef.current = getLocalDisplayName;

  useEffect(() => {
    const unsubscribes = Object.values(connections).map((connection) =>
      connection?.subscribeToLiveMessages((message) => {
        if (!getSettings().chatMessageSound) {
          return;
        }
        if (message.displayName === getLocalDisplayNameRef.current()) {
          return;
        }

        playAlertSound("chat-message");
      }),
    );

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe?.());
    };
  }, [connections]);
}
