import { Volume2, VolumeX } from "lucide-react";
import { Slider } from "@/components/ui/slider";

interface VolumeControlProps {
  isMuted: boolean;
  /** 0–100 */
  volume: number;
  disabled?: boolean;
  onVolumeChange: (value: number) => void;
  onToggleMute: () => void;
}

export function VolumeControl({
  isMuted,
  volume,
  disabled = false,
  onVolumeChange,
  onToggleMute,
}: VolumeControlProps) {
  const effectiveVolume = isMuted ? 0 : volume;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggleMute}
        disabled={disabled}
        className="flex items-center text-white disabled:opacity-40"
        aria-label={isMuted ? "Unmute" : "Mute"}
      >
        {isMuted || volume === 0 ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
      </button>
      <Slider
        className="w-20"
        value={effectiveVolume}
        min={0}
        max={100}
        step={1}
        disabled={disabled}
        onValueChange={(value) =>
          onVolumeChange(typeof value === "number" ? value : (value[0] ?? 0))
        }
      />
    </div>
  );
}
