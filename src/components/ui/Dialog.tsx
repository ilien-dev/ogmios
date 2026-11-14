import { useEffect, useRef } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";

interface DialogProps {
  open: boolean;
  /** The id of the heading that names it. */
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A modal over the whole window. The app behind it is inert while it is
 * open, so focus stays inside; Escape or a click on the scrim closes it, and
 * focus goes back to where it was.
 */
export function Dialog({
  open,
  labelledBy,
  onClose,
  children,
}: DialogProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const before = document.activeElement;
    const app = document.getElementById("root");
    app?.setAttribute("inert", "");
    panel.current?.focus();
    return () => {
      app?.removeAttribute("inert");
      if (before instanceof HTMLElement) {
        before.focus();
      }
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const onScrim = (event: MouseEvent): void => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return createPortal(
    <Presence>
      {open && (
        <Reveal
          key="scrim"
          kind="fade"
          onClick={onScrim}
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4"
        >
          <Reveal
            ref={panel}
            kind="scale"
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="flex max-h-full w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-xl bg-surface p-6 shadow-float outline-none"
          >
            {children}
          </Reveal>
        </Reveal>
      )}
    </Presence>,
    document.body,
  );
}
