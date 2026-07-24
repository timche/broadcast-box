import { MAX_DISPLAY_NAME_LENGTH } from "@/lib/webrtc/chat";

const STORAGE_KEY = "chat-display-name";

/** Returns the saved chat display name, or an empty string if none is set. */
export function getDisplayName(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Persists the chat display name (trimmed and length-capped). */
export function setDisplayName(name: string): void {
  const trimmed = name.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  try {
    if (trimmed === "") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, trimmed);
    }
  } catch {
    // Ignore storage failures (private mode, quota); the name still lives in state.
  }
}
