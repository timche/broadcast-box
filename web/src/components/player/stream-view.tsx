import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Player } from "@/components/player/player";
import { AvailableStreams } from "@/components/available-streams";
import { HeaderPortal } from "@/components/layout/header-portal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const HEADER_HEIGHT = "2.75rem";

/** Computes a balanced grid (as square as possible) for `count` cells. */
function balancedGrid(count: number): { cols: number; rows: number } {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

export function StreamView({ streamKeys }: { streamKeys: string[] }) {
  const navigate = useNavigate();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newStreamKey, setNewStreamKey] = useState("");

  const goToKeys = (keys: string[]) => {
    void navigate({ to: "/$", params: { _splat: keys.join("/") } });
  };

  const addStream = (streamKey: string) => {
    const trimmed = streamKey.trim();
    setNewStreamKey("");
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
  const { cols, rows } = balancedGrid(streamKeys.length);

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
        <div
          className="grid size-full"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          }}
        >
          {streamKeys.map((streamKey) => (
            <div key={streamKey} className="relative min-h-0 min-w-0">
              <Player streamKey={streamKey} showClose onClose={() => removeStream(streamKey)} />
            </div>
          ))}
        </div>
      )}

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
