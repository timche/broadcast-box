import { useSyncExternalStore } from "react";
import { getSettings, subscribeToSettings, type Settings } from "@/lib/settings";

/** Reads the persisted settings and re-renders whenever any of them change. */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribeToSettings, getSettings);
}
