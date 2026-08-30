import { Video, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StreamState } from "@/lib/types";

interface StatusMessageProps {
  streamKey: string;
  state: StreamState;
  onRetry?: () => void;
}

const MESSAGES: Record<Exclude<StreamState, "Playing">, string> = {
  Error: "encountered an error",
  Offline: "is not online",
  Loading: "is loading",
  Reconnecting: "is reconnecting",
  Disconnected: "lost connection",
};

export function StatusMessage({ streamKey, state, onRetry }: StatusMessageProps) {
  if (state === "Playing") {
    return null;
  }

  const isLive = state === "Loading" || state === "Reconnecting";
  const Icon = isLive ? Video : VideoOff;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center text-center">
      <div className="flex flex-col items-center gap-2 font-light">
        <Icon
          className={`size-24 ${state === "Error" ? "text-destructive" : "text-muted-foreground"}`}
        />
        <div className="text-2xl">{streamKey}</div>
        <div className="text-muted-foreground text-xl">{MESSAGES[state]}</div>

        {state === "Disconnected" && onRetry && (
          <Button className="pointer-events-auto mt-2" onClick={onRetry} variant="secondary">
            Reconnect
          </Button>
        )}
      </div>
    </div>
  );
}
