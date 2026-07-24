import { useNavigate } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import ReactGridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
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
import { addWatchedStream } from "@/lib/watched";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const HEADER_HEIGHT = "2.75rem";
const HEADER_PX = 44;
const GRID_UNITS = 12;
const GRID_GAP = 6;

const cardId = (key: string) => `${key}_card`;

/** A balanced (as-square-as-possible) default layout filling the 12×12 grid. */
function buildDefaultLayout(keys: string[]): Layout {
  const count = keys.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const w = Math.max(1, Math.floor(GRID_UNITS / cols));
  const h = Math.max(1, Math.floor(GRID_UNITS / rows));
  return keys.map((key, index) => ({
    i: cardId(key),
    x: (index % cols) * w,
    y: Math.floor(index / cols) * h,
    w,
    h,
  }));
}

/** Keeps existing positions for kept streams; gives new streams a default slot. */
function reconcileLayout(previous: Layout, keys: string[]): Layout {
  const previousById = new Map(previous.map((item) => [item.i, item]));
  const defaultById = new Map(buildDefaultLayout(keys).map((item) => [item.i, item]));
  return keys.map((key) => {
    const id = cardId(key);
    return (
      previousById.get(id) ??
      defaultById.get(id) ?? { i: id, x: 0, y: 0, w: GRID_UNITS, h: GRID_UNITS }
    );
  });
}

export function StreamView({ streamKeys }: { streamKeys: string[] }) {
  const navigate = useNavigate();
  const { width: gridWidth, containerRef } = useContainerWidth();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newStreamName, setNewStreamName] = useState("");
  const [layout, setLayout] = useState<Layout>(() => buildDefaultLayout(streamKeys));
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  // Remember every stream watched (used for "Previously watched").
  useEffect(() => {
    streamKeys.forEach((name) => addWatchedStream(name));
  }, [streamKeys]);

  // Reconcile the grid layout when the set of streams changes.
  useEffect(() => {
    setLayout((previous) => reconcileLayout(previous, streamKeys));
  }, [streamKeys]);

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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
  const isMobile = viewport.w < 768;
  const availableHeight = viewport.h - HEADER_PX;
  const rowHeight = Math.max(
    1,
    Math.floor((availableHeight - GRID_GAP * (GRID_UNITS - 1)) / GRID_UNITS),
  );

  return (
    <div className="w-full bg-black" style={{ height: `calc(100dvh - ${HEADER_HEIGHT})` }}>
      <HeaderPortal>
        <Button size="sm" variant="secondary" onClick={() => setIsAddOpen(true)}>
          <Plus className="size-4" />
          Add stream
        </Button>
      </HeaderPortal>

      {isSingle ? (
        <Player streamKey={streamKeys[0]} />
      ) : (
        <div ref={containerRef} className="h-full w-full overflow-auto">
          <ReactGridLayout
            width={gridWidth}
            layout={layout}
            onLayoutChange={setLayout}
            dragConfig={{
              enabled: !isMobile,
              handle: ".player-drag-handle",
              cancel: ".player-drag-cancel",
            }}
            resizeConfig={{ enabled: !isMobile }}
            gridConfig={{
              cols: GRID_UNITS,
              rowHeight,
              margin: [GRID_GAP, GRID_GAP],
              containerPadding: [0, 0],
            }}
          >
            {streamKeys.map((streamKey) => (
              <div
                key={cardId(streamKey)}
                className="flex h-full flex-col overflow-hidden rounded-md bg-black"
              >
                <div className="player-drag-handle flex h-6 shrink-0 cursor-move items-center justify-between gap-2 bg-neutral-900 px-2 text-xs text-white">
                  <span className="truncate">{streamKey}</span>
                  <button
                    type="button"
                    className="player-drag-cancel rounded p-0.5 hover:bg-white/10"
                    aria-label={`Remove ${streamKey}`}
                    onClick={() => removeStream(streamKey)}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                <div className="relative min-h-0 flex-1">
                  <Player streamKey={streamKey} />
                </div>
              </div>
            ))}
          </ReactGridLayout>
        </div>
      )}

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
