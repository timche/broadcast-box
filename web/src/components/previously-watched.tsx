import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { getWatchedStreams } from "@/lib/watched";

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

  const excluded = new Set((exclude ?? []).map((name) => name.toLowerCase()));
  const streams = getWatchedStreams().filter((name) => !excluded.has(name.toLowerCase()));

  const handleSelect = (streamName: string) => {
    if (onSelect) {
      onSelect(streamName);
      return;
    }
    void navigate({ to: "/$", params: { _splat: streamName } });
  };

  return (
    <div className="flex flex-col gap-2">
      {showHeader && <h2 className="text-lg font-semibold tracking-tight">Previously watched</h2>}

      {streams.length === 0 ? (
        <p className="text-muted-foreground py-2 text-center">No previously watched streams yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {streams.map((name) => (
            <Button
              key={name}
              variant="secondary"
              className="justify-center py-3 font-medium"
              onClick={() => handleSelect(name)}
            >
              {name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
