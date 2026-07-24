const STORAGE_KEY = "watched-streams";
const MAX_ENTRIES = 50;

/** Returns the most-recently-watched stream names (newest first). */
export function getWatchedStreams(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

/** Records a watched stream name, moving it to the front of the list. */
export function addWatchedStream(name: string): void {
  const trimmed = name.trim();
  if (trimmed === "") {
    return;
  }
  const next = [
    trimmed,
    ...getWatchedStreams().filter((entry) => entry.toLowerCase() !== trimmed.toLowerCase()),
  ];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(0, MAX_ENTRIES)));
}

/** Removes a stream name from the watched list. */
export function removeWatchedStream(name: string): void {
  const next = getWatchedStreams().filter((entry) => entry.toLowerCase() !== name.toLowerCase());
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
