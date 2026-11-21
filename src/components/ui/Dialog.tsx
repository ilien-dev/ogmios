import { useEffect, useRef } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";

interface DialogProps {
  open: boolean;
  /** The id of the heading that names it. */
  labelledBy: string;
  onClose: () => void;
  /** `side` stands along the right edge, full height, with its own close. */
  placement?: "centre" | "side";
  children: ReactNode;
}

/**
 * A modal over the whole window. The app behind it is inert while it is
 * open, so focus stays inside, on the element marked `data-autofocus` if it
 * has one; Escape or a click on the scrim closes it, and focus goes back to
 * where it was. A side one is a sheet along the right
 * edge, for a list to browse, and says how to close it.
 */
export function Dialog({
  open,
  labelledBy,
  onClose,
  placement = "centre",
  children,
}: DialogProps): ReactNode {
  const { t } = useTranslation();
  const side = placement === "side";
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const before = document.activeElement;
    const app = document.getElementById("root");
    app?.setAttribute("inert", "");
    const first = panel.current?.querySelector("[data-autofocus]");
    (first instanceof HTMLElement ? first : panel.current)?.focus();
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
          className={cn(
            "fixed inset-0 z-50 flex bg-scrim p-4 backdrop-blur-sm",
            side ? "items-stretch justify-end" : "items-center justify-center",
          )}
        >
          <Reveal
            ref={panel}
            kind={side ? "slide" : "scale"}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className={cn(
              "relative flex max-h-full w-full flex-col gap-4 overflow-y-auto rounded-2xl border border-line bg-surface/95 p-6 shadow-float backdrop-blur-xl outline-none",
              side ? "h-full max-w-md" : "max-w-lg",
            )}
          >
            <Presence>
              {side && (
                <Reveal
                  key="close"
                  kind="fade"
                  className="absolute top-4 right-4"
                >
                  <button
                    type="button"
                    aria-label={t("common.close")}
                    onClick={onClose}
                    className="group flex size-11 items-center justify-center rounded-full text-ink-soft transition-control hover:bg-raised hover:text-ink"
                  >
                    <X
                      aria-hidden
                      className="size-4.5 transition-transform duration-300 ease-out-expo group-hover:rotate-90"
                    />
                  </button>
                </Reveal>
              )}
            </Presence>
            {children}
          </Reveal>
        </Reveal>
      )}
    </Presence>,
    document.body,
  );
}
