import { useCallback, useEffect, useRef, useState } from "react";

const HIDE_DELAY_MS = 2_500;

/**
 * Mimics a native video player's controls: overlays stay visible while the
 * pointer is active over the player and fade out after a period of inactivity.
 */
export function useControlsVisibility(hideDelayMs = HIDE_DELAY_MS) {
  const [visible, setVisible] = useState(true);
  const timeoutRef = useRef<number | null>(null);

  const clearHideTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clearHideTimeout();
    setVisible(true);
    timeoutRef.current = window.setTimeout(() => setVisible(false), hideDelayMs);
  }, [clearHideTimeout, hideDelayMs]);

  const hide = useCallback(() => {
    clearHideTimeout();
    setVisible(false);
  }, [clearHideTimeout]);

  useEffect(() => clearHideTimeout, [clearHideTimeout]);

  return {
    visible,
    containerProps: {
      onMouseMove: show,
      onMouseEnter: show,
      onMouseLeave: hide,
      onTouchStart: show,
    },
  };
}
