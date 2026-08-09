import { useMediaQuery } from "@/hooks/use-media-query";

/** Below Tailwind's `md` breakpoint, where the desktop layouts stop fitting. */
const NARROW_VIEWPORT_QUERY = "(max-width: 767px)";

/** True on phones and narrow windows — the layouts built for one column. */
export function useIsNarrowViewport(): boolean {
  return useMediaQuery(NARROW_VIEWPORT_QUERY);
}
