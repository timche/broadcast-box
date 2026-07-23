import { useNavigate } from "@tanstack/react-router";
import { Clapperboard, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import ReactGridLayout, { useContainerWidth } from "react-grid-layout";
import { AvailableStreams } from "@/components/available-streams";
import { Player } from "@/components/player/player";
import { StreamMotd } from "@/components/player/stream-motd";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { StreamStatus } from "@/lib/types";
import { useCinemaMode } from "@/providers/cinema-mode";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const GRID_GAP = 8;
const GRID_ROW_HEIGHT = 16;
const GRID_COLUMNS = 12;

interface MultiviewProps {
  initialStreamKey: string;
}

export function Multiview({ initialStreamKey }: MultiviewProps) {
  const navigate = useNavigate();
  const { cinemaMode, toggleCinemaMode } = useCinemaMode();
  const { width: gridWidth, containerRef } = useContainerWidth();

  const [streamKeys, setStreamKeys] = useState<string[]>([initialStreamKey]);
  const [statuses, setStatuses] = useState<Record<string, StreamStatus | undefined>>({});
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newStreamKey, setNewStreamKey] = useState("");

  const addStream = useCallback((streamKey: string) => {
    const trimmed = streamKey.trim();
    if (trimmed === "") {
      return;
    }
    setStreamKeys((prev) =>
      prev.some((key) => key.toLowerCase() === trimmed.toLowerCase()) ? prev : [...prev, trimmed],
    );
    setNewStreamKey("");
    setIsAddOpen(false);
  }, []);

  const removeStream = useCallback((streamKey: string) => {
    setStreamKeys((prev) => prev.filter((key) => key !== streamKey));
    setStatuses((prev) => {
      const next = { ...prev };
      delete next[streamKey];
      return next;
    });
  }, []);

  const handleStatusChange = useCallback((streamKey: string, status: StreamStatus) => {
    setStatuses((prev) => (prev[streamKey] === status ? prev : { ...prev, [streamKey]: status }));
  }, []);

  const isSingle = streamKeys.length === 1;
  const columns = isSingle ? 1 : 2;
  const isMobile = window.innerWidth < 768;
  const itemGridWidth = GRID_COLUMNS / columns;
  const itemPixelWidth = (gridWidth - GRID_GAP * (columns - 1)) / columns;
  const cardPixelHeight = Math.ceil((itemPixelWidth * 9) / 16 + 24);
  const cardRows = Math.max(
    1,
    Math.ceil((cardPixelHeight + GRID_GAP) / (GRID_ROW_HEIGHT + GRID_GAP)),
  );

  return (
    <div className={cinemaMode ? "w-full" : "container mx-auto w-full px-2 py-2"}>
      <div ref={containerRef} className="w-full">
        <ReactGridLayout
          width={gridWidth}
          dragConfig={{
            enabled: !isMobile,
            handle: ".player-drag-handle",
            cancel: ".player-drag-cancel,button,input,select,textarea,a,[role='button']",
          }}
          resizeConfig={{ enabled: !isMobile }}
          gridConfig={{
            cols: GRID_COLUMNS,
            rowHeight: GRID_ROW_HEIGHT,
            margin: [GRID_GAP, GRID_GAP],
            containerPadding: [0, 0],
          }}
          layout={streamKeys.map((streamKey, index) => ({
            i: `${streamKey}_player_card`,
            x: (index % columns) * itemGridWidth,
            y: Math.floor(index / columns) * cardRows,
            w: itemGridWidth,
            h: cardRows,
          }))}
        >
          {streamKeys.map((streamKey) => (
            <div key={`${streamKey}_player_card`} className="flex h-full flex-col gap-1">
              <div className="min-h-0 flex-1">
                <Player
                  streamKey={streamKey}
                  cinemaMode={cinemaMode}
                  fillContainer
                  onStreamStatusChange={handleStatusChange}
                  onCloseStream={
                    isSingle ? () => void navigate({ to: "/" }) : () => removeStream(streamKey)
                  }
                />
              </div>
              <StreamMotd
                isOnline={statuses[streamKey]?.isOnline ?? false}
                motd={statuses[streamKey]?.motd ?? ""}
                className="px-1"
              />
            </div>
          ))}
        </ReactGridLayout>
      </div>

      <div className="mt-4 flex justify-center gap-2">
        <Button variant="secondary" onClick={toggleCinemaMode}>
          <Clapperboard className="size-4" />
          {cinemaMode ? "Exit cinema mode" : "Cinema mode"}
        </Button>
        <Button onClick={() => setIsAddOpen(true)}>
          <Plus className="size-4" />
          Add stream
        </Button>
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a stream</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Stream key"
            value={newStreamKey}
            onChange={(event) => setNewStreamKey(event.target.value)}
            onKeyUp={(event) => {
              if (event.key === "Enter") {
                addStream(newStreamKey);
              }
            }}
          />
          <AvailableStreams showHeader={false} onSelect={addStream} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
