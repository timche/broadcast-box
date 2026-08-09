import { useCallback, useRef } from "react";
import { playAlertSound } from "@/lib/alert-sounds";
import { getSettings } from "@/lib/settings";

/**
 * Returns a reporter to feed each stream's viewer count into. It blips
 * whenever a count moves, provided the setting is on.
 *
 * The first count seen for a stream only records a baseline, so opening a
 * stream that already has an audience is silent. Pass null while a stream is
 * offline to drop that baseline — otherwise everyone reconnecting after a
 * restart would sound like a crowd arriving.
 */
export function useViewerAlert() {
  const previousCountsRef = useRef(new Map<string, number>());

  return useCallback((streamKey: string, viewerCount: number | null) => {
    const previousCounts = previousCountsRef.current;

    if (viewerCount === null) {
      previousCounts.delete(streamKey);
      return;
    }

    const previousCount = previousCounts.get(streamKey);
    previousCounts.set(streamKey, viewerCount);

    if (previousCount === undefined || previousCount === viewerCount) {
      return;
    }

    if (getSettings().viewerAlertSound) {
      playAlertSound(viewerCount > previousCount ? "viewer-join" : "viewer-leave");
    }
  }, []);
}
