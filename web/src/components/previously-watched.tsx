import { useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getWatchedStreams, removeWatchedStream } from "@/lib/watched";

interface PreviouslyWatchedProps {
  showHeader?: boolean;
  /** Stream names to omit (e.g. those already open in the current view). */
  exclude?: string[];
  /** Overrides the default "navigate to watch" behavior. */
  onSelect?: (streamName: string) => void;
}

export function PreviouslyWatched({
  showHeader = true,
  exclude,
  onSelect,
}: PreviouslyWatchedProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState(getWatchedStreams);

  const excluded = new Set((exclude ?? []).map((name) => name.toLowerCase()));
  const streams = items.filter((name) => !excluded.has(name.toLowerCase()));

  const handleSelect = (streamName: string) => {
    if (onSelect) {
      onSelect(streamName);
      return;
    }
    void navigate({ to: "/$", params: { _splat: streamName } });
  };

  const handleRemove = (streamName: string) => {
    removeWatchedStream(streamName);
    setItems(getWatchedStreams());
  };

  return (
    <div className="flex flex-col gap-2">
      {showHeader && <h2 className="text-lg font-semibold tracking-tight">Previously watched</h2>}

      {streams.length === 0 ? (
        <p className="text-muted-foreground py-2 text-center">No previously watched streams yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {streams.map((name) => (
            <div key={name} className="flex items-center gap-2">
              <Button
                variant="secondary"
                className="flex-1 justify-center py-3 font-medium"
                onClick={() => handleSelect(name)}
              >
                {name}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${name}`}
                onClick={() => handleRemove(name)}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
