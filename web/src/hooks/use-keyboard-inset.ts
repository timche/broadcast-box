import { useEffect, useState } from "react";

function isTextEntry(element: Element | null): boolean {
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

/**
 * How much of the layout viewport the on-screen keyboard covers, in pixels.
 *
 * Mobile browsers don't resize the layout viewport when the keyboard opens —
 * they shrink the *visual* viewport and scroll the page to reveal the focused
 * input, which drags a full-height overlay's footer out of sight. Reserving
 * this much space at the bottom keeps the composer above the keyboard instead.
 *
 * Only measured while a text field has focus. Collapsing browser toolbars
 * shrink the visual viewport too, and reading those as a keyboard would leave
 * a permanent gap at the bottom of the page.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === null) {
      return;
    }

    const update = () => {
      if (!isTextEntry(document.activeElement)) {
        setInset(0);
        return;
      }

      const covered = document.documentElement.clientHeight - viewport.height - viewport.offsetTop;
      setInset(Math.max(0, Math.round(covered)));
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);

    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);

  return inset;
}
