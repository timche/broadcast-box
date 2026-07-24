import { useNavigate } from "@tanstack/react-router";
import { MessageSquare, Plus, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Chat } from "@/components/chat/chat";
import { HeaderPortal } from "@/components/layout/header-portal";
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
import { cn } from "@/lib/utils";
import { addWatchedStream } from "@/lib/watched";

const HEADER_HEIGHT = "2.75rem";

/** Split the streams into a balanced (as-square-as-possible) grid of rows. */
function buildRows(streamKeys: string[]): string[][] {
  const cols = Math.max(1, Math.ceil(Math.sqrt(streamKeys.length)));
  const rows: string[][] = [];
  for (let i = 0; i < streamKeys.length; i += cols) {
    rows.push(streamKeys.slice(i, i + cols));
  }
  return rows;
}

export function StreamView({ streamKeys }: { streamKeys: string[] }) {
  const navigate = useNavigate();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newStreamName, setNewStreamName] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatChannels, setChatChannels] = useState<Record<string, RTCDataChannel | null>>({});

  const [collapsedChats, setCollapsedChats] = useState<Record<string, boolean>>({});

  const setChatChannelFor = useCallback((streamKey: string, channel: RTCDataChannel | null) => {
    setChatChannels((current) => ({ ...current, [streamKey]: channel }));
  }, []);

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
  const rows = buildRows(streamKeys);

  return (
    <div className="w-full bg-black" style={{ height: `calc(100dvh - ${HEADER_HEIGHT})` }}>
      <HeaderPortal>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setIsAddOpen(true)}>
            <Plus className="size-4" />
            Add stream
          </Button>
          <Button
            size="sm"
            variant={chatOpen ? "default" : "secondary"}
            onClick={() => setChatOpen((open) => !open)}
            aria-label={chatOpen ? "Hide chat" : "Show chat"}
          >
            <MessageSquare className="size-4" />
            Chat
          </Button>
        </div>
      </HeaderPortal>

      <div className="flex size-full">
        <div className="relative min-w-0 flex-1">
          {isSingle ? (
            <Player
              streamKey={streamKeys[0]}
              onChatChannel={(c) => setChatChannelFor(streamKeys[0], c)}
            />
          ) : (
            // Re-tiling on a stream set change is done by remounting the group
            // (keyed on the stream list) so panel sizes reset to an even split.
            <ResizablePanelGroup key={streamKeys.join("/")} orientation="vertical">
              {rows.map((rowKeys, rowIndex) => (
                <Fragment key={rowKeys.join("/")}>
                  {rowIndex > 0 && <ResizableHandle />}
                  <ResizablePanel minSize={80}>
                    <ResizablePanelGroup orientation="horizontal">
                      {rowKeys.map((streamKey, colIndex) => (
                        <Fragment key={streamKey}>
                          {colIndex > 0 && <ResizableHandle />}
                          <ResizablePanel minSize={80}>
                            <div className="flex h-full flex-col overflow-hidden bg-black">
                              <div className="flex h-6 shrink-0 items-center justify-between gap-2 bg-neutral-900 px-2 text-xs text-white">
                                <span className="truncate">{streamKey}</span>
                                <button
                                  type="button"
                                  className="rounded p-0.5 hover:bg-white/10"
                                  aria-label={`Remove ${streamKey}`}
                                  onClick={() => removeStream(streamKey)}
                                >
                                  <X className="size-3.5" />
                                </button>
                              </div>
                              <div className="relative min-h-0 flex-1">
                                <Player
                                  streamKey={streamKey}
                                  onChatChannel={(c) => setChatChannelFor(streamKey, c)}
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

        {chatOpen && (
          <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l md:w-80">
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
