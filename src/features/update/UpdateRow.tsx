import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpCircle } from "lucide-react";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Spinner } from "@/components/ui/Spinner";
import { offered, useUpdate } from "./update";

const ANSWER_MS = 4000;

/**
 * The running version, in Settings. Pressed, it looks for a newer release and
 * answers in place. A newer one turns it into the way back to the card, for
 * one put away with Later.
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
        <Reveal key="newer" kind="fade">
          <button
            type="button"
            onClick={unfold}
            className="flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-accent-text transition duration-150 hover:bg-raised"
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
          {state.kind === "checking" && <Spinner className="size-3" />}
          {t(
            state.kind === "checking"
              ? "update.checking"
              : "update.unreachable",
          )}
        </Reveal>
      );
    }
    return (
      <Reveal key="version" kind="fade">
        <button
          type="button"
          title={t("update.check")}
          onClick={() => {
            setAsked(true);
            check();
          }}
          className="flex h-9 items-center rounded-full px-3 text-xs text-ink-faint transition duration-150 hover:bg-raised hover:text-ink-soft"
        >
          {t(asked ? "update.upToDate" : "update.short", { version })}
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
