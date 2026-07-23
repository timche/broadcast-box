import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const HEADER_ACTIONS_ID = "header-actions";

/** Renders its children into the header's actions slot (top-right of the global header). */
export function HeaderPortal({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById(HEADER_ACTIONS_ID));
  }, []);

  if (target === null) {
    return null;
  }
  return createPortal(children, target);
}
