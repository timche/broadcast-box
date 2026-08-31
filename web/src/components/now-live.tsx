import { useNavigate } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLiveStreams } from "@/hooks/use-live-streams";

interface NowLiveProps {
  showHeader?: boolean;
  /** Stream names to omit (e.g. those already open in the current view). */
  exclude?: string[];
  /** Overrides the default "navigate to watch" behavior. */
  onSelect?: (streamName: string) => void;
}

/**
 * The streams that are live right now.
 *
 * Nothing renders when none are, rather than an empty state: a viewer who has
 * been here before wants the list of what is on, and a permanent line saying
 * there is nothing would only push the rest of the page down.
 */
export function NowLive({ showHeader = true, exclude, onSelect }: NowLiveProps) {
  const navigate = useNavigate();
  const liveStreams = useLiveStreams();

  const excluded = new Set((exclude ?? []).map((name) => name.toLowerCase()));
  const streams = liveStreams.filter((stream) => !excluded.has(stream.name.toLowerCase()));

  if (streams.length === 0) {
    return null;
  }

  const handleSelect = (streamName: string) => {
    if (onSelect) {
      onSelect(streamName);
      return;
    }
    void navigate({ to: "/$", params: { _splat: streamName } });
  };

  return (
    <div className="flex flex-col gap-2">
      {showHeader && <h2 className="text-lg font-semibold tracking-tight">Now live</h2>}

      <div className="flex flex-wrap gap-2">
        {streams.map((stream) => (
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
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-red-500" />
            {stream.name}
            {stream.viewers > 0 && (
              <span className="text-muted-foreground flex items-center gap-1 font-normal tabular-nums">
                <Users className="size-3" aria-hidden />
                {stream.viewers}
              </span>
            )}
          </Button>
        ))}
      </div>
    </div>
  );
}
