import { Settings } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { previewAlertSound, type AlertSound } from "@/lib/alert-sounds";
import { updateSettings, type Settings as UserSettings } from "@/lib/settings";

/** The settings that are a plain on/off switch. */
type SoundSettingId = {
  [Key in keyof UserSettings]: UserSettings[Key] extends boolean ? Key : never;
}[keyof UserSettings];

const VOLUME_LABEL_ID = "alert-volume-label";

/** The volume is stored as a gain multiplier, but read as a percentage. */
function toPercent(volume: number): number {
  return Math.round(volume * 100);
}

/** The slider is typed for multi-thumb ranges; this one only ever has the one. */
function toVolume(percent: number | readonly number[]): number {
  return (typeof percent === "number" ? percent : (percent[0] ?? 0)) / 100;
}

interface SoundSettingProps {
  id: SoundSettingId;
  label: string;
  description: ReactNode;
  /** Played when the setting is switched on, as a preview of the sound. */
  preview: AlertSound;
  checked: boolean;
  volume: number;
}

function SoundSetting({ id, label, description, preview, checked, volume }: SoundSettingProps) {
  const handleCheckedChange = (enabled: boolean) => {
    updateSettings({ [id]: enabled });
    // Switching on is a user gesture, which is what unlocks audio playback for
    // the automatic chimes later — and it doubles as a volume preview.
    if (enabled) {
      previewAlertSound(preview, volume);
    }
  };

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-1">
        <label htmlFor={id} className="text-sm leading-none font-medium">
          {label}
        </label>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={handleCheckedChange} />
    </div>
  );
}

/** Titlebar cog opening the per-browser settings. */
export function SettingsButton() {
  const [isOpen, setIsOpen] = useState(false);
  const settings = useSettings();

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setIsOpen(true)}
        aria-label="Settings"
        title="Settings"
        className="shrink-0"
      >
        <Settings className="size-4" />
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>Saved in this browser.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-5">
            <SoundSetting
              id="viewerAlertSound"
              label="Viewer sound"
              description="A chime whenever the viewer count goes up or down."
              preview="viewer-join"
              checked={settings.viewerAlertSound}
              volume={settings.alertVolume}
            />
            <SoundSetting
              id="chatMessageSound"
              label="Chat sound"
              description="A chime whenever someone else posts a chat message."
              preview="chat-message"
              checked={settings.chatMessageSound}
              volume={settings.alertVolume}
            />

            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-4">
                <span id={VOLUME_LABEL_ID} className="text-sm leading-none font-medium">
                  Volume
                </span>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {toPercent(settings.alertVolume)}%
                </span>
              </div>
              <Slider
                aria-labelledby={VOLUME_LABEL_ID}
                value={toPercent(settings.alertVolume)}
                min={0}
                max={100}
                step={5}
                onValueChange={(percent) => updateSettings({ alertVolume: toVolume(percent) })}
                // Previewing only once the drag ends keeps a sweep across the
                // track from firing a chime at every step along the way.
                onValueCommitted={(percent) => previewAlertSound("viewer-join", toVolume(percent))}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
