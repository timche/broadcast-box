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
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { previewAlertSound, type AlertSound } from "@/lib/alert-sounds";
import { updateSettings, type Settings as UserSettings } from "@/lib/settings";

interface SoundSettingProps {
  id: keyof UserSettings;
  label: string;
  description: ReactNode;
  /** Played when the setting is switched on, as a preview of the sound. */
  preview: AlertSound;
  checked: boolean;
}

function SoundSetting({ id, label, description, preview, checked }: SoundSettingProps) {
  const handleCheckedChange = (enabled: boolean) => {
    updateSettings({ [id]: enabled });
    // Switching on is a user gesture, which is what unlocks audio playback for
    // the automatic blips later — and it doubles as a volume preview.
    if (enabled) {
      previewAlertSound(preview);
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
              description="A quiet blip whenever the viewer count goes up or down."
              preview="viewer-join"
              checked={settings.viewerAlertSound}
            />
            <SoundSetting
              id="chatMessageSound"
              label="Chat sound"
              description="A quiet blip whenever someone else posts a chat message."
              preview="chat-message"
              checked={settings.chatMessageSound}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
