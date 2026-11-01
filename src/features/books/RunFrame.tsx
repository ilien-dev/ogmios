import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Presence } from "@/components/motion/Presence";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Orb } from "@/components/ui/Orb";
import { ProgressBar } from "@/components/ui/ProgressBar";

interface RunFrameProps {
  /** What the bar measures, for a screen reader. */
  barLabel: string;
  value: number;
  total: number;
  /** Where the learner is, in words: "2 of 10". */
  count: string;
  /** Why the last step failed; null when none did. */
  failure: string | null;
  /** A step is running: the two ways out wait for it. */
  busy: boolean;
  pause: string;
  finish: string;
  onPause: () => void;
  onFinish: () => void;
  children: ReactNode;
}

/**
 * The whole window of a session of sentences, structures or dictation: how
 * far it is across the top, the small orb over one thing at a time, and under
 * it, always, the two ways out. The orb stays out of what is swapped, so it
 * goes on drifting from one sentence to the next.
 */
export function RunFrame({
  barLabel,
  value,
  total,
  count,
  failure,
  busy,
  pause,
  finish,
  onPause,
  onFinish,
  children,
}: RunFrameProps): ReactNode {
  const { t } = useTranslation();
  return (
    <main className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-6 px-6 nav:px-10">
        <div className="min-w-0 flex-1">
          <ProgressBar
            label={barLabel}
            value={value}
            total={total}
            tone="book"
          />
        </div>
        <p className="text-sm text-ink-faint tabular-nums">{count}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col items-center gap-2">
          <Orb size="sm" section="book" className="shrink-0" />
          <Presence>
            {failure !== null && (
              <Notice
                key="failure"
                tone="danger"
                className="w-full max-w-3xl shrink-0"
              >
                {t("common.error", { message: failure })}
              </Notice>
            )}
          </Presence>
          <div className="relative grid w-full flex-1 overflow-clip">
            {children}
          </div>
        </div>
      </div>
      <footer className="flex shrink-0 gap-3 px-6 py-4 nav:px-10">
        <Button variant="ghost" disabled={busy} onClick={onPause}>
          {pause}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onFinish}>
          {finish}
        </Button>
      </footer>
    </main>
  );
}
