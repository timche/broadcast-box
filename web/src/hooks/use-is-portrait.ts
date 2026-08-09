import { useMediaQuery } from "@/hooks/use-media-query";

const PORTRAIT_QUERY = "(orientation: portrait)";

/**
 * Tracks whether the viewport is taller than it is wide — true on a phone held
 * upright, and on narrow desktop windows.
 */
export function useIsPortrait(): boolean {
  return useMediaQuery(PORTRAIT_QUERY);
}
