import { useLiveChatMessages } from "@/hooks/use-live-chat-messages";
import { playAlertSound } from "@/lib/alert-sounds";
import { getSettings } from "@/lib/settings";
import type { ChatConnection } from "@/lib/webrtc/chat";

/**
 * Blips for every chat message relayed to the given connections, provided the
 * setting is on.
 *
 * `getLocalDisplayName` is read per message (the viewer can rename themselves
 * mid-conversation) and keeps your own echo silent. The backend has no notion
 * of "sent by me", so someone chatting under your name is silent too.
 */
export function useChatMessageAlert(
  connections: Record<string, ChatConnection | null>,
  getLocalDisplayName: () => string,
): void {
  useLiveChatMessages(connections, (message) => {
    if (!getSettings().chatMessageSound) {
      return;
    }
    if (message.displayName === getLocalDisplayName()) {
      return;
    }

    playAlertSound("chat-message");
  });
}
