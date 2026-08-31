import { useNavigate } from "@tanstack/react-router";
import { Columns2, Expand, Eye, MessageSquare, Plus, Rows2, Shrink, X } from "lucide-react";
import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useGroupRef } from "react-resizable-panels";
import { Chat } from "@/components/chat/chat";
import { HeaderPortal } from "@/components/layout/header-portal";
import { SettingsButton } from "@/components/layout/settings-button";
import { Player } from "@/components/player/player";
import { NowLive } from "@/components/now-live";
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
import { useControlsVisibility } from "@/hooks/use-controls-visibility";
import { useIsNarrowViewport } from "@/hooks/use-is-narrow-viewport";
import { useIsPortrait } from "@/hooks/use-is-portrait";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useLiveChatMessages } from "@/hooks/use-live-chat-messages";
import { useViewerAlert } from "@/hooks/use-viewer-alert";
import { getDisplayName } from "@/lib/display-name";
import type { StreamStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { addWatchedStream } from "@/lib/watched";
import type { ChatConnection } from "@/lib/webrtc/chat";

const HEADER_HEIGHT = "2.75rem";

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

/**
 * A panel group that resets its panels to an even split whenever `resetKey`
 * changes.
 *
 * Re-tiling used to reset the sizes by remounting the group, which took every
 * player inside it down with it: a fresh WHEP negotiation, new ICE and a new
 * SSE channel per stream, for nothing more than a device rotation.
 *
 * The panels inside deliberately carry no `id`, leaving them the generated
 * ones: a group remembers a layout per panel set, under a key that joins the
 * ids with a comma, and a viewer can name a stream anything — including
 * something with a comma in it, which would alias two sets onto one remembered
 * layout and hand the group a layout of the wrong length.
 */
function EvenSplitPanelGroup({
  resetKey,
  orientation,
  children,
}: {
  resetKey: string;
  orientation: "horizontal" | "vertical";
  children: ReactNode;
}) {
  const groupRef = useGroupRef();

  useEffect(() => {
    // A frame later than the commit: a panel added in this render only reaches
    // the group on its next one, and a layout naming an unregistered panel is
    // rejected.
    const frame = requestAnimationFrame(() => {
      const group = groupRef.current;
      if (group === null) {
        return;
      }

      // Taken from the group itself rather than from the streams, so the layout
      // covers exactly the panels it holds however far behind the tiles it is.
      const panelIds = Object.keys(group.getLayout());
      if (panelIds.length === 0) {
        return;
      }

      group.setLayout(
        Object.fromEntries(panelIds.map((panelId) => [panelId, 100 / panelIds.length])),
      );
    });

    return () => cancelAnimationFrame(frame);
  }, [resetKey, groupRef]);

  return (
    <ResizablePanelGroup groupRef={groupRef} orientation={orientation}>
      {children}
    </ResizablePanelGroup>
  );
}

export function StreamView({ streamKeys }: { streamKeys: string[] }) {
  const navigate = useNavigate();
  const isPortrait = useIsPortrait();
  const isNarrow = useIsNarrowViewport();
  const keyboardInset = useKeyboardInset();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newStreamName, setNewStreamName] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  // Null until the viewer picks a layout, so rotating the device keeps
  // following the orientation default.
  const [tileLayoutOverride, setTileLayoutOverride] = useState<TileLayout | null>(null);
  const [chatChannels, setChatChannels] = useState<Record<string, ChatConnection | null>>({});

  // Streams over the whole viewport, header and chat included. Desktop only:
  // a narrow viewport has nothing beside the streams to reclaim.
  const [theaterMode, setTheaterMode] = useState(false);
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
  // Every arrangement the tiles can take, so any change to one resets the
  // panels back to an even split.
  const retileKey = `${tileLayout}:${streamKeys.join("/")}`;

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

  // A single stream has no titlebar to carry its viewer count, so the count
  // goes in the header instead.
  const headerViewers = isSingle ? (viewerCounts[streamKeys[0]] ?? 0) : null;

  // Dropping to a narrow viewport leaves theater mode for good rather than
  // holding it, so widening the window again doesn't resurrect it unasked.
  useEffect(() => {
    if (isNarrow) {
      setTheaterMode(false);
    }
  }, [isNarrow]);

  // The exit button is the only way out on screen, so Escape backs it up the
  // way it does for fullscreen video.
  useEffect(() => {
    if (!theaterMode) {
      return;
    }

    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTheaterMode(false);
      }
    };
    window.addEventListener("keydown", exitOnEscape);

    return () => window.removeEventListener("keydown", exitOnEscape);
  }, [theaterMode]);

  // Mirrors the player's own overlays: the exit button rides the same
  // pointer-idle fade as the video controls under it.
  const { visible: exitVisible, containerProps: theaterProps } = useControlsVisibility();

  // Falls back to the first stream when the selected one has been removed.
  const activeChatKey =
    selectedChatKey !== null && streamKeys.includes(selectedChatKey)
      ? selectedChatKey
      : streamKeys[0];

  return (
    <div
      // Theater mode lifts the streams out of the layout and over the header,
      // which stays mounted underneath so leaving puts everything back.
      className={cn("bg-black", theaterMode ? "fixed inset-0 z-50" : "relative w-full")}
      style={theaterMode ? undefined : { height: `calc(100dvh - ${HEADER_HEIGHT})` }}
      {...(theaterMode ? theaterProps : {})}
    >
      <HeaderPortal>
        <div className="flex items-center gap-2">
          {headerViewers !== null && (
            <span
              role="status"
              aria-label={`${headerViewers} watching`}
              title={`${headerViewers} watching`}
              className="text-muted-foreground flex shrink-0 items-center gap-1 text-sm tabular-nums"
            >
              <Eye className="size-4" />
              {headerViewers}
            </span>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setIsAddOpen(true)}
            aria-label="Add stream"
            title="Add stream"
          >
            <Plus className="size-4" />
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
            </Button>
          )}
          {!isNarrow && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setTheaterMode(true)}
              aria-label="Theater mode"
              title="Fill the viewport with the stream"
            >
              <Expand className="size-4" />
            </Button>
          )}
          <Button
            size="sm"
            variant={chatOpen ? "default" : "secondary"}
            onClick={() => setChatOpen((open) => !open)}
            aria-label={
              hasUnreadChat ? "Show chat, new messages" : chatOpen ? "Hide chat" : "Show chat"
            }
            title={chatOpen ? "Hide chat" : "Show chat"}
            className="relative"
          >
            <MessageSquare className="size-4" />
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

      {theaterMode && (
        <div
          className={cn(
            "absolute right-2 z-50 transition-opacity duration-300",
            // Clears the tile titlebars, which own the same corner.
            isSingle ? "top-2" : "top-8",
            exitVisible ? "opacity-100" : "opacity-0",
          )}
        >
          <button
            type="button"
            onClick={() => setTheaterMode(false)}
            aria-label="Exit theater mode"
            title="Exit theater mode"
            className="rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
          >
            <Shrink className="size-4" />
          </button>
        </div>
      )}

      <div className="flex size-full flex-col md:flex-row">
        <div className="relative min-h-0 min-w-0 flex-1">
          {/* One stream goes through the same panel tree as many, minus the
              titlebar, so adding a second one leaves the first player mounted. */}
          <EvenSplitPanelGroup
            resetKey={retileKey}
            orientation={isHorizontal ? "vertical" : "horizontal"}
          >
            {groups.map((groupKeys, groupIndex) => (
              // Keyed on the position rather than the streams in it: buildGroups
              // rebalances when a stream is added, and a key naming the contents
              // would remount every player whose group it changed.
              <Fragment key={`group-${groupIndex}`}>
                {groupIndex > 0 && <ResizableHandle />}
                <ResizablePanel minSize={80}>
                  <EvenSplitPanelGroup
                    resetKey={retileKey}
                    orientation={isHorizontal ? "horizontal" : "vertical"}
                  >
                    {groupKeys.map((streamKey, indexInGroup) => (
                      <Fragment key={streamKey}>
                        {indexInGroup > 0 && <ResizableHandle />}
                        <ResizablePanel minSize={80}>
                          <div className="flex h-full flex-col overflow-hidden bg-black">
                            {!isSingle && (
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
                            )}
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
                  </EvenSplitPanelGroup>
                </ResizablePanel>
              </Fragment>
            ))}
          </EvenSplitPanelGroup>
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
                    // Chat covers the tiles here, so it stands in for their
                    // titlebars — except with a single stream, whose count is
                    // in the header and stays visible behind chat.
                    viewers={isSingle ? null : (viewerCounts[streamKey] ?? 0)}
                  />
                </TabsContent>
              ))}
            </Tabs>
          )}

        {/* Theater mode gives the whole viewport to the streams, chat column
            included; leaving it puts chat back as it was. */}
        {chatOpen && !isNarrow && !theaterMode && (
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
          <NowLive showHeader={false} exclude={streamKeys} onSelect={addStream} />
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
