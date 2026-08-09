import { useEffect, useState } from "react";

const PORTRAIT_QUERY = "(orientation: portrait)";

/**
 * Tracks whether the viewport is taller than it is wide — true on a phone held
 * upright, and on narrow desktop windows.
 */
export function useIsPortrait() {
  const [isPortrait, setIsPortrait] = useState(() => window.matchMedia(PORTRAIT_QUERY).matches);

  useEffect(() => {
    const portrait = window.matchMedia(PORTRAIT_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsPortrait(event.matches);

    setIsPortrait(portrait.matches);
    portrait.addEventListener("change", handleChange);

    return () => portrait.removeEventListener("change", handleChange);
  }, []);

  return isPortrait;
}
