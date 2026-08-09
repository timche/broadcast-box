/** Viewer preferences, persisted per browser and shared by every route. */
export interface Settings {
  /** Chime when the viewer count of a watched or broadcast stream changes. */
  viewerAlertSound: boolean;
  /** Chime when someone else posts a chat message. */
  chatMessageSound: boolean;
}

const STORAGE_KEY = "settings";

/**
 * Both alerts are on out of the box. Nothing can actually make noise until the
 * page has been interacted with (browsers keep audio locked until then), so a
 * viewer who never opens the dialog is not ambushed on page load.
 */
const DEFAULT_SETTINGS: Settings = {
  viewerAlertSound: true,
  chatMessageSound: true,
};

function readStoredSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored: unknown = raw === null ? null : JSON.parse(raw);
    if (stored === null || typeof stored !== "object") {
      return DEFAULT_SETTINGS;
    }

    const { viewerAlertSound, chatMessageSound } = stored as Partial<Settings>;

    return {
      viewerAlertSound: viewerAlertSound ?? DEFAULT_SETTINGS.viewerAlertSound,
      chatMessageSound: chatMessageSound ?? DEFAULT_SETTINGS.chatMessageSound,
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
