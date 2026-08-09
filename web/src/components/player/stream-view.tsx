import { useNavigate } from "@tanstack/react-router";
import { Columns2, Eye, MessageSquare, Plus, Rows2, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Chat } from "@/components/chat/chat";
import { HeaderPortal } from "@/components/layout/header-portal";
import { SettingsButton } from "@/components/layout/settings-button";
import { Player } from "@/components/player/player";
import { PreviouslyWatched } from "@/components/previously-watched";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useChatMessageAlert } from "@/hooks/use-chat-message-alert";
import { useIsPortrait } from "@/hooks/use-is-portrait";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useLiveChatMessages } from "@/hooks/use-live-chat-messages";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useViewerAlert } from "@/hooks/use-viewer-alert";
import { getDisplayName } from "@/lib/display-name";
import type { StreamStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { addWatchedStream } from "@/lib/watched";
import type { ChatConnection } from "@/lib/webrtc/chat";

const HEADER_HEIGHT = "2.75rem";

/** Below Tailwind's `md` breakpoint the chat sidebar no longer fits. */
const NARROW_VIEWPORT_QUERY = "(max-width: 767px)";

/**
 * Which way the streams flow before wrapping: "horizontal" fills a row first
 * (two streams end up side by side), "vertical" fills a column first (two
 * streams end up stacked).
 */
type TileLayout = "horizontal" | "vertical";

/**
 * Split the streams into balanced (as-square-as-possible) groups — a group is
 * a row in the horizontal layout and a column in the vertical one.
 */
function buildGroups(streamKeys: string[]): string[][] {
  const groupSize = Math.max(1, Math.ceil(Math.sqrt(streamKeys.length)));
  const groups: string[][] = [];
  for (let i = 0; i < streamKeys.length; i += groupSize) {
    groups.push(streamKeys.slice(i, i + groupSize));
  }
  return groups;
}

export function StreamView({ streamKeys }: { streamKeys: string[] }) {
  const navigate = useNavigate();
  const isPortrait = useIsPortrait();
  const isNarrow = useMediaQuery(NARROW_VIEWPORT_QUERY);
  const keyboardInset = useKeyboardInset();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newStreamName, setNewStreamName] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  // Null until the viewer picks a layout, so rotating the device keeps
  // following the orientation default.
  const [tileLayoutOverride, setTileLayoutOverride] = useState<TileLayout | null>(null);
  const [chatChannels, setChatChannels] = useState<Record<string, ChatConnection | null>>({});

  const [collapsedChats, setCollapsedChats] = useState<Record<string, boolean>>({});
  const [viewerCounts, setViewerCounts] = useState<Record<string, number>>({});
  const [selectedChatKey, setSelectedChatKey] = useState<string | null>(null);
  const [hasUnreadChat, setHasUnreadChat] = useState(false);

  const setChatChannelFor = useCallback((streamKey: string, channel: ChatConnection | null) => {
    setChatChannels((current) => ({ ...current, [streamKey]: channel }));
  }, []);

  const reportViewerCount = useViewerAlert();
  useChatMessageAlert(chatChannels, getDisplayName);

  const handleStreamStatus = useCallback(
    (streamKey: string, status: StreamStatus) => {
      setViewerCounts((current) => ({
        ...current,
        [streamKey]: status.isOnline ? status.viewers : 0,
      }));
      reportViewerCount(streamKey, status.isOnline ? status.viewers : null);
    },
    [reportViewerCount],
  );

  // Remember every stream watched (used for "Previously watched").
  useEffect(() => {
    streamKeys.forEach((name) => addWatchedStream(name));
  }, [streamKeys]);

  const goToKeys = (keys: string[]) => {
    void navigate({ to: "/$", params: { _splat: keys.join("/") } });
  };

  const addStream = (streamName: string) => {
    const trimmed = streamName.trim();
    setNewStreamName("");
    setIsAddOpen(false);
    if (trimmed === "" || streamKeys.some((key) => key.toLowerCase() === trimmed.toLowerCase())) {
      return;
    }
    goToKeys([...streamKeys, trimmed]);
  };

  const removeStream = (streamKey: string) => {
    const next = streamKeys.filter((key) => key !== streamKey);
    if (next.length === 0) {
      void navigate({ to: "/" });
      return;
    }
    goToKeys(next);
  };

  const isSingle = streamKeys.length === 1;
  // A portrait viewport has no width to spare, so streams stack by default
  // there and sit side by side in landscape.
  const tileLayout = tileLayoutOverride ?? (isPortrait ? "vertical" : "horizontal");
  const isHorizontal = tileLayout === "horizontal";
  const groups = buildGroups(streamKeys);

  useLiveChatMessages(chatChannels, () => {
    if (!chatOpen) {
      setHasUnreadChat(true);
    }
  });

  useEffect(() => {
    if (chatOpen) {
      setHasUnreadChat(false);
    }
  }, [chatOpen]);

  // Tile titlebars carry the viewer count, so the chat header beside them
  // doesn't repeat it. A single stream has no titlebar, so it keeps the count.
  const tilesShowViewers = !isSingle;
  // Falls back to the first stream when the selected one has been removed.
  const activeChatKey =
    selectedChatKey !== null && streamKeys.includes(selectedChatKey)
      ? selectedChatKey
      : streamKeys[0];

  return (
    <div className="relative w-full bg-black" style={{ height: `calc(100dvh - ${HEADER_HEIGHT})` }}>
      <HeaderPortal>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setIsAddOpen(true)}
            aria-label="Add stream"
          >
            <Plus className="size-4" />
            <span className="hidden sm:inline">Add stream</span>
          </Button>
          {!isSingle && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setTileLayoutOverride(isHorizontal ? "vertical" : "horizontal")}
              aria-label={isHorizontal ? "Stack streams" : "Place streams side by side"}
              title="Flip the direction the streams are tiled in"
            >
              {isHorizontal ? <Rows2 className="size-4" /> : <Columns2 className="size-4" />}
              <span className="hidden sm:inline">{isHorizontal ? "Stack" : "Side by side"}</span>
            </Button>
          )}
          <Button
            size="sm"
            variant={chatOpen ? "default" : "secondary"}
            onClick={() => setChatOpen((open) => !open)}
            aria-label={
              hasUnreadChat ? "Show chat, new messages" : chatOpen ? "Hide chat" : "Show chat"
            }
            className="relative"
          >
            <MessageSquare className="size-4" />
            <span className="hidden sm:inline">{chatOpen ? "Hide chat" : "Show chat"}</span>
            {hasUnreadChat && (
              <span
                aria-hidden
                className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-red-500"
              />
            )}
          </Button>
          <SettingsButton />
        </div>
      </HeaderPortal>

      <div className="flex size-full flex-col md:flex-row">
        <div className="relative min-h-0 min-w-0 flex-1">
          {isSingle ? (
            <Player
              streamKey={streamKeys[0]}
              onChatChannel={(c) => setChatChannelFor(streamKeys[0], c)}
              onStreamStatusChange={handleStreamStatus}
            />
          ) : (
            // Re-tiling on a stream set or layout change is done by remounting
            // the group (keyed on both) so panel sizes reset to an even split.
            <ResizablePanelGroup
              key={`${tileLayout}:${streamKeys.join("/")}`}
              orientation={isHorizontal ? "vertical" : "horizontal"}
            >
              {groups.map((groupKeys, groupIndex) => (
                <Fragment key={groupKeys.join("/")}>
                  {groupIndex > 0 && <ResizableHandle />}
                  <ResizablePanel minSize={80}>
                    <ResizablePanelGroup orientation={isHorizontal ? "horizontal" : "vertical"}>
                      {groupKeys.map((streamKey, indexInGroup) => (
                        <Fragment key={streamKey}>
                          {indexInGroup > 0 && <ResizableHandle />}
                          <ResizablePanel minSize={80}>
                            <div className="flex h-full flex-col overflow-hidden bg-black">
                              <div className="flex h-6 shrink-0 items-center justify-between gap-2 bg-neutral-900 px-2 text-xs text-white">
                                <span className="truncate">{streamKey}</span>
                                <span className="flex shrink-0 items-center gap-1">
                                  <span
                                    className="flex items-center gap-1 tabular-nums"
                                    title={`${viewerCounts[streamKey] ?? 0} watching`}
                                  >
                                    <Eye className="size-3.5" />
                                    {viewerCounts[streamKey] ?? 0}
                                  </span>
                                  <button
                                    type="button"
                                    className="rounded p-0.5 hover:bg-white/10"
                                    aria-label={`Remove ${streamKey}`}
                                    onClick={() => removeStream(streamKey)}
                                  >
                                    <X className="size-3.5" />
                                  </button>
                                </span>
                              </div>
                              <div className="relative min-h-0 flex-1">
                                <Player
                                  streamKey={streamKey}
                                  onChatChannel={(c) => setChatChannelFor(streamKey, c)}
                                  onStreamStatusChange={handleStreamStatus}
                                />
                              </div>
                            </div>
                          </ResizablePanel>
                        </Fragment>
                      ))}
                    </ResizablePanelGroup>
                  </ResizablePanel>
                </Fragment>
              ))}
            </ResizablePanelGroup>
          )}
        </div>

        {chatOpen &&
          isNarrow && (
            // Narrow viewports have no room for the video and a column of
            // chats, so one chat covers everything below the header and the
            // tabs switch between them.
            <Tabs
              value={activeChatKey}
              onValueChange={(value) => setSelectedChatKey(String(value))}
              className="bg-background/95 absolute inset-0 z-30 flex flex-col gap-0 backdrop-blur"
              style={{ bottom: keyboardInset }}
            >
              {!isSingle && (
                <TabsList
                  variant="line"
                  className="w-full shrink-0 justify-start overflow-x-auto border-b px-2"
                >
                  {streamKeys.map((streamKey) => (
                    <TabsTrigger key={streamKey} value={streamKey} className="shrink-0">
                      {streamKey}
                    </TabsTrigger>
                  ))}
                </TabsList>
              )}
              {streamKeys.map((streamKey) => (
                // Kept mounted so switching tabs doesn't discard a half-typed
                // message.
                <TabsContent
                  key={streamKey}
                  value={streamKey}
                  keepMounted
                  className="min-h-0 flex-1"
                >
                  <Chat
                    channel={chatChannels[streamKey] ?? null}
                    viewers={viewerCounts[streamKey] ?? 0}
                  />
                </TabsContent>
              ))}
            </Tabs>
          )}

        {chatOpen && !isNarrow && (
          <aside className="flex min-h-0 w-80 shrink-0 flex-col overflow-y-auto border-l">
            {streamKeys.map((streamKey) => {
              const collapsed = collapsedChats[streamKey] ?? false;
              return (
                <div
                  key={streamKey}
                  className={cn(
                    "not-last:border-b",
                    isSingle || !collapsed ? "min-h-0 flex-1" : "shrink-0",
                  )}
                >
                  <Chat
                    title={isSingle ? undefined : streamKey}
                    channel={chatChannels[streamKey] ?? null}
                    viewers={tilesShowViewers ? null : (viewerCounts[streamKey] ?? 0)}
                    collapsible={!isSingle}
                    collapsed={!isSingle && collapsed}
                    onCollapsedChange={(next) =>
                      setCollapsedChats((current) => ({ ...current, [streamKey]: next }))
                    }
                  />
                </div>
              );
            })}
          </aside>
        )}
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a stream</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Stream name"
            value={newStreamName}
            onChange={(event) => setNewStreamName(event.target.value)}
            onKeyUp={(event) => {
              if (event.key === "Enter") {
                addStream(newStreamName);
              }
            }}
          />
          <PreviouslyWatched showHeader={false} exclude={streamKeys} onSelect={addStream} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsAddOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => addStream(newStreamName)} disabled={newStreamName.trim() === ""}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
