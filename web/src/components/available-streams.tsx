import { useNavigate } from "@tanstack/react-router";
import { Radio } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useStatusQuery } from "@/lib/queries/status";

interface AvailableStreamsProps {
  showHeader?: boolean;
  /** Overrides the default "navigate to watch" behavior (used by the multiview add-stream modal). */
  onSelect?: (streamKey: string) => void;
}

export function AvailableStreams({ showHeader = true, onSelect }: AvailableStreamsProps) {
  const navigate = useNavigate();
  const { data } = useStatusQuery();

  const streams = useMemo(
    () =>
      data
        ?.filter((entry) => entry.videoTracks.length > 0)
        .sort((a, b) => a.streamKey.localeCompare(b.streamKey))
        .map((entry) => ({ streamKey: entry.streamKey, motd: entry.motd })) ?? [],
    [data],
  );

  const handleSelect = (streamKey: string) => {
    if (onSelect) {
      onSelect(streamKey);
      return;
    }
    void navigate({ to: "/$", params: { _splat: streamKey } });
  };

  return (
    <div className="flex flex-col gap-2">
      {showHeader && (
        <h2 className="mb-2 flex items-center gap-2 text-2xl font-light">
          <Radio className="size-5" />
          Live streams
        </h2>
      )}

      {streams.length === 0 ? (
        <p className="text-muted-foreground py-2 text-center">No streams are live right now.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {streams.map((stream) => (
            <Button
              key={stream.streamKey}
              variant="secondary"
              className="h-auto flex-col items-center gap-0.5 py-3"
              onClick={() => handleSelect(stream.streamKey)}
            >
              <span className="font-medium">{stream.streamKey}</span>
              {stream.motd && (
                <span className="text-muted-foreground text-xs font-normal">{stream.motd}</span>
              )}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
