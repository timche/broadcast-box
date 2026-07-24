import { Pencil, SendHorizontal } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { useChat } from "@/hooks/use-chat";
import { getDisplayName, setDisplayName } from "@/lib/display-name";
import { cn } from "@/lib/utils";
import { type ChatMessage, type ChatStatus, MAX_MESSAGE_LENGTH } from "@/lib/webrtc/chat";

/** Deterministic, readable name colour derived from the display name. */
function nameColor(displayName: string): string {
  let hash = 0;
  for (let index = 0; index < displayName.length; index += 1) {
    hash = displayName.charCodeAt(index) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360} 65% 65%)`;
}

const STATUS_LABEL: Record<ChatStatus, string> = {
  connecting: "Connecting",
  connected: "Connected",
  disconnected: "Offline",
  error: "Error",
};

function ChatLine({ message }: { message: ChatMessage }) {
  return (
    <MessageScrollerItem
      messageId={message.id}
      className="px-3 text-sm leading-snug [contain-intrinsic-size:auto_2rem]"
    >
      <span className="font-semibold" style={{ color: nameColor(message.displayName) }}>
        {message.displayName}
      </span>
      <span className="text-muted-foreground">: </span>
      <span className="text-foreground wrap-break-word">{message.text}</span>
    </MessageScrollerItem>
  );
}

interface ChatProps {
  channel: RTCDataChannel | null;
  className?: string;
}

export function Chat({ channel, className }: ChatProps) {
  const { messages, status, sendMessage } = useChat(channel);

  const [name, setName] = useState(getDisplayName);
  const [editingName, setEditingName] = useState(false);
  const [draft, setDraft] = useState("");

  const trimmedName = name.trim();
  const canSend = status === "connected" && draft.trim().length > 0 && trimmedName.length > 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (trimmedName.length === 0) {
      setEditingName(true);
      return;
    }
    if (sendMessage(draft, trimmedName)) {
      setDraft("");
    }
  };

  const commitName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDisplayName(name);
    setName(name.trim());
    setEditingName(false);
  };

  const statusColor = useMemo(() => {
    switch (status) {
      case "connected":
        return "bg-green-500";
      case "connecting":
        return "animate-pulse bg-yellow-400";
      default:
        return "bg-red-500";
    }
  }, [status]);

  return (
    <div className={cn("bg-background flex size-full min-h-0 flex-col", className)}>
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <span className="text-sm font-semibold">Stream Chat</span>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <span className={cn("size-2 rounded-full", statusColor)} />
          {STATUS_LABEL[status]}
        </span>
      </div>

      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport className="py-2">
            <MessageScrollerContent className="gap-1.5">
              {messages.length === 0 ? (
                <div className="text-muted-foreground px-3 py-6 text-center text-xs">
                  {status === "connected"
                    ? "No messages yet. Say hello!"
                    : "Waiting for the chat connection…"}
                </div>
              ) : (
                messages.map((message) => <ChatLine key={message.id} message={message} />)
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <div className="shrink-0 border-t p-3">
        <form onSubmit={submit} className="flex items-center gap-2">
          <Input
            value={draft}
            maxLength={MAX_MESSAGE_LENGTH}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Send a message"
            aria-label="Chat message"
          />
          <Button type="submit" size="icon" disabled={!canSend} aria-label="Send message">
            <SendHorizontal className="size-4" />
          </Button>
        </form>

        {editingName ? (
          <form onSubmit={commitName} className="mt-2 flex items-center gap-2">
            <Input
              autoFocus
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="Display name"
              aria-label="Display name"
              className="h-7 text-xs"
            />
            <Button type="submit" size="xs" variant="secondary">
              Save
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="text-muted-foreground hover:text-foreground mt-2 flex items-center gap-1 text-xs"
          >
            <Pencil className="size-3" />
            {trimmedName.length > 0 ? (
              <span>
                Chatting as <span className="text-foreground font-medium">{trimmedName}</span>
              </span>
            ) : (
              <span>Set a display name to chat</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
