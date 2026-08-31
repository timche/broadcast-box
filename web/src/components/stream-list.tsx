import { useNavigate } from "@tanstack/react-router";
import { Users, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { useLiveStreams } from "@/hooks/use-live-streams";
import { useStreamOnline } from "@/hooks/use-stream-online";
import { cn } from "@/lib/utils";
import { getWatchedStreams, removeWatchedStream } from "@/lib/watched";

interface StreamListProps {
  showHeader?: boolean;
  /** Stream names to omit (e.g. those already open in the current view). */
  exclude?: string[];
  /** Overrides the default "navigate to watch" behavior. */
  onSelect?: (streamName: string) => void;
}

/**
 * Every stream a viewer can reach from here: the ones live right now, then the
 * ones they have watched before that are not.
 *
 * The two used to be separate sections, which showed a stream twice whenever a
 * remembered one came back on, and gave the same chip two meanings of "live" —
 * a red dot in one list and a green one in the other.
 *
 * Nothing renders when there is nothing in either half, rather than an empty
 * state: a permanent line saying there is nothing to watch would only push the
 * rest of the page down.
 */
export function StreamList({ showHeader = true, exclude, onSelect }: StreamListProps) {
  const navigate = useNavigate();
  const liveStreams = useLiveStreams();
  const [watched, setWatched] = useState(getWatchedStreams);

  const excluded = new Set((exclude ?? []).map((name) => name.toLowerCase()));
  // Dedupe against every live stream, not only the ones that survive `exclude`:
  // a stream already open in the view should stay out of both halves.
  const liveNames = new Set(liveStreams.map((stream) => stream.name.toLowerCase()));

  const live = liveStreams.filter((stream) => !excluded.has(stream.name.toLowerCase()));
  const offline = watched.filter(
    (name) => !excluded.has(name.toLowerCase()) && !liveNames.has(name.toLowerCase()),
  );

  if (live.length === 0 && offline.length === 0) {
    return null;
  }

  const handleSelect = (streamName: string) => {
    if (onSelect) {
      onSelect(streamName);
      return;
    }
    void navigate({ to: "/$", params: { _splat: streamName } });
  };

  const handleRemove = (streamName: string) => {
    removeWatchedStream(streamName);
    setWatched(getWatchedStreams());
  };

  return (
    <div className="flex flex-col gap-2">
      {showHeader && <h2 className="text-lg font-semibold tracking-tight">Streams</h2>}

      <div className="flex flex-wrap gap-2">
        {live.map((stream) => (
          <Button
            key={stream.name}
            variant="secondary"
            size="sm"
            className="font-medium"
            aria-label={
              stream.viewers === 0
                ? `Watch ${stream.name}`
                : `Watch ${stream.name}, ${stream.viewers} watching`
            }
            onClick={() => handleSelect(stream.name)}
          >
            <StatusDot live />
            {stream.name}
            {stream.viewers > 0 && (
              <span className="text-muted-foreground flex items-center gap-1 font-normal tabular-nums">
                <Users className="size-3" aria-hidden />
                {stream.viewers}
              </span>
            )}
          </Button>
        ))}

        {offline.map((name) => (
          <WatchedStreamChip
            key={name}
            name={name}
            onSelect={() => handleSelect(name)}
            onRemove={() => handleRemove(name)}
          />
        ))}
      </div>
    </div>
  );
}

function StatusDot({ live }: { live: boolean }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        live ? "animate-pulse bg-red-500" : "bg-muted-foreground/40",
      )}
      title={live ? "Live" : "Offline"}
    />
  );
}

/**
 * A remembered stream, with the remove button the live half has no use for:
 * removing a live stream from `localStorage` would leave it on screen anyway,
 * since the status list is what puts it there.
 *
 * Liveness comes from `?key=` per name rather than from the list, which is the
 * only source left when DISABLE_STATUS is set and the list form is off.
 */
function WatchedStreamChip({
  name,
  onSelect,
  onRemove,
}: {
  name: string;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const isLive = useStreamOnline(name);

  return (
    <ButtonGroup>
      <Button variant="secondary" size="sm" className="font-medium" onClick={onSelect}>
        <StatusDot live={isLive} />
        {name}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className="text-muted-foreground hover:text-foreground border-background/30 border-l px-2"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
      >
        <X className="size-4" />
      </Button>
    </ButtonGroup>
  );
}
