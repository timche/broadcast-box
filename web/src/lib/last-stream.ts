const STORAGE_KEY = "last-stream-name";

/** Returns the stream name last used on the home page, or an empty string. */
export function getLastStreamName(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Remembers the stream name last used on the home page. */
export function setLastStreamName(name: string): void {
  const trimmed = name.trim();
  try {
    if (trimmed === "") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, trimmed);
    }
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}
