import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpCircle, RefreshCw } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { offered, useUpdate } from "./update";
import { Reveal } from "@/components/motion/Reveal";
import { Presence } from "@/components/motion/Presence";

const ANSWER_MS = 4000;

/**
 * The running version, in Settings, and the one way to look for a newer
 * release, which answers in place. A newer one turns the action into the way
 * back to the card, for one put away with Later.
 */
export function UpdateRow(): ReactNode {
  const { t } = useTranslation();
  const { version, state, check, unfold } = useUpdate();
  // The answer to a press shows for a moment; a check nobody asked for is silent.
  const [asked, setAsked] = useState(false);
  const newer = offered(state);

  useEffect(() => {
    const timer =
      asked && state.kind !== "checking"
        ? setTimeout(() => {
            setAsked(false);
          }, ANSWER_MS)
        : null;
    return () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [asked, state.kind]);

  const row = (): ReactNode => {
    if (newer !== null) {
      return (
        <Reveal key="newer" kind="fade" className="flex items-center gap-1">
          <Presence>
            {version !== null && (
              <Reveal
                key="version"
                as="span"
                kind="fade"
                className="px-3 text-sm text-ink-soft"
              >
                {t("update.short", { version })}
              </Reveal>
            )}
          </Presence>
          <button
            type="button"
            onClick={unfold}
            className="flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-accent-text transition-control hover:bg-raised"
          >
            <ArrowUpCircle aria-hidden className="size-4" />
            {t("update.hint", { version: newer })}
          </button>
        </Reveal>
      );
    }
    if (version === null) {
      return null;
    }
    if (asked && state.kind !== "current") {
      return (
        <Reveal
          key="answer"
          as="p"
          kind="fade"
          aria-live="polite"
          className="flex min-h-9 items-center gap-2 px-3 text-xs text-ink-faint"
        >
          <Presence>
            {state.kind === "checking" && (
              <Reveal key="checking" as="span" kind="fade">
                <Spinner className="size-3" />
              </Reveal>
            )}
          </Presence>
          {t(
            state.kind === "checking"
              ? "update.checking"
              : "update.unreachable",
          )}
        </Reveal>
      );
    }
    return (
      <Reveal key="version" kind="fade" className="flex items-center gap-1">
        <span className="px-3 text-sm text-ink-soft">
          {t(asked ? "update.upToDate" : "update.short", { version })}
        </span>
        <button
          type="button"
          onClick={() => {
            setAsked(true);
            check();
          }}
          className="flex h-9 items-center gap-2 rounded-full px-3 text-sm text-ink-soft transition-control hover:bg-raised hover:text-ink"
        >
          <RefreshCw aria-hidden className="size-4" />
          {t("update.check")}
        </button>
      </Reveal>
    );
  };

  return (
    <div className="relative">
      <Presence swap>{row()}</Presence>
    </div>
  );
}
