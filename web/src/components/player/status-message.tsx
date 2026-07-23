import { Video, VideoOff } from "lucide-react";
import type { StreamState } from "@/lib/types";

interface StatusMessageProps {
  streamKey: string;
  state: StreamState;
}

export function StatusMessage({ streamKey, state }: StatusMessageProps) {
  if (state === "Playing") {
    return null;
  }

  const message =
    state === "Error"
      ? "encountered an error"
      : state === "Offline"
        ? "is not online"
        : "is loading";

  const Icon = state === "Loading" ? Video : VideoOff;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center text-center">
      <div className="flex flex-col items-center gap-2 font-light">
        <Icon
          className={`size-24 ${state === "Error" ? "text-destructive" : "text-muted-foreground"}`}
        />
        <div className="text-2xl">{streamKey}</div>
        <div className="text-muted-foreground text-xl">{message}</div>
      </div>
    </div>
  );
}
