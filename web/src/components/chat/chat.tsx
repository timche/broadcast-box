import { ChevronDown, ChevronRight, SendHorizontal } from "lucide-react";
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
import {
  type ChatMessage,
  type ChatStatus,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_MESSAGE_LENGTH,
} from "@/lib/webrtc/chat";

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
  title?: string;
  className?: string;
  /** When set, the header becomes a toggle that collapses the chat body. */
  collapsible?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function Chat({
  channel,
  title = "Stream Chat",
  className,
  collapsible = false,
  collapsed = false,
  onCollapsedChange,
}: ChatProps) {
  const { messages, status, sendMessage } = useChat(channel);

  const [nickname, setNickname] = useState(getDisplayName);
  const [nameDraft, setNameDraft] = useState("");
  const [draft, setDraft] = useState("");

  const trimmedNickname = nickname.trim();
  const hasNickname = trimmedNickname.length > 0;
  // A nickname is set once, up front — until then the message input is replaced
  // by the nickname form and there is no way to change it afterwards.
  const canSend = status === "connected" && draft.trim().length > 0 && hasNickname;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sendMessage(draft, trimmedNickname)) {
      setDraft("");
    }
  };

  const commitName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = nameDraft.trim();
    if (trimmed.length === 0) {
      return;
    }
    setDisplayName(trimmed);
    setNickname(trimmed);
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

  const header = (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        {collapsible &&
          (collapsed ? (
            <ChevronRight className="size-4 shrink-0" />
          ) : (
            <ChevronDown className="size-4 shrink-0" />
          ))}
        <span className="truncate text-sm font-semibold" title={title}>
          {title}
        </span>
      </span>
      <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <span className={cn("size-2 rounded-full", statusColor)} />
        {STATUS_LABEL[status]}
      </span>
    </>
  );

  return (
    <div className={cn("bg-background flex size-full min-h-0 flex-col", className)}>
      {collapsible ? (
        <button
          type="button"
          onClick={() => onCollapsedChange?.(!collapsed)}
          aria-expanded={!collapsed}
          className="hover:bg-muted/50 flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3 text-left transition-colors"
        >
          {header}
        </button>
      ) : (
        <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
          {header}
        </div>
      )}

      {collapsed ? null : (
        <>
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
            {hasNickname ? (
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
            ) : (
              <form onSubmit={commitName} className="flex flex-col gap-2">
                <p className="text-muted-foreground text-xs">Set a nickname to join the chat.</p>
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    value={nameDraft}
                    maxLength={MAX_DISPLAY_NAME_LENGTH}
                    onChange={(event) => setNameDraft(event.target.value)}
                    placeholder="Nickname"
                    aria-label="Nickname"
                  />
                  <Button type="submit" disabled={nameDraft.trim().length === 0}>
                    Join
                  </Button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
