/** Viewer preferences, persisted per browser and shared by every route. */
export interface Settings {
  /** Chime when the viewer count of a watched or broadcast stream changes. */
  viewerAlertSound: boolean;
  /** Chime when someone else posts a chat message. */
  chatMessageSound: boolean;
  /** How loud both chimes are, from 0 (muted) to 1. */
  alertVolume: number;
}

const STORAGE_KEY = "settings";

/**
 * Both alerts are on out of the box. Nothing can actually make noise until the
 * page has been interacted with (browsers keep audio locked until then), so a
 * viewer who never opens the dialog is not ambushed on page load.
 *
 * The default volume leaves room to turn the chimes up for a loud stream while
 * still being audible over one out of the box.
 */
const DEFAULT_SETTINGS: Settings = {
  viewerAlertSound: true,
  chatMessageSound: true,
  alertVolume: 0.7,
};

/** Guards against a hand-edited or half-written volume silencing every alert. */
function normalizeVolume(volume: unknown): number {
  if (typeof volume !== "number" || !Number.isFinite(volume)) {
    return DEFAULT_SETTINGS.alertVolume;
  }

  return Math.min(Math.max(volume, 0), 1);
}

function readStoredSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored: unknown = raw === null ? null : JSON.parse(raw);
    if (stored === null || typeof stored !== "object") {
      return DEFAULT_SETTINGS;
    }

    const { viewerAlertSound, chatMessageSound, alertVolume } = stored as Partial<Settings>;

    return {
      viewerAlertSound: viewerAlertSound ?? DEFAULT_SETTINGS.viewerAlertSound,
      chatMessageSound: chatMessageSound ?? DEFAULT_SETTINGS.chatMessageSound,
      alertVolume: normalizeVolume(alertVolume),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let settings = readStoredSettings();
const listeners = new Set<() => void>();

/** The current settings. The reference is stable until something changes. */
export function getSettings(): Settings {
  return settings;
}

/** Subscribes to settings changes; returns the unsubscribe function. */
export function subscribeToSettings(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Persists a settings patch and notifies every subscriber. */
export function updateSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures (private mode, quota).
  }

  listeners.forEach((listener) => listener());
}
