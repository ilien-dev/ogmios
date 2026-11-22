import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import type {
  Direction,
  PenaltyAnswer,
  PenaltyStep,
  PracticeStep,
} from "@shared/domain";
import { CountUp } from "@/components/motion/CountUp";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { VerdictLine } from "@/components/ui/Verdict";
import { answerPenalty } from "@/lib/ipc";
import { cn } from "@/lib/cn";
import { languageName } from "@/lib/text";
import { SittingItem } from "./SittingItem";

/** The rungs a penalty climbs, by how many it asks each way. */
const RUNGS = [3, 6, 12, 24] as const;
const TOP = RUNGS.length;

/** How tall each rung stands, the lowest first. */
const HEIGHTS = ["h-1/4", "h-2/4", "h-3/4", "h-full"] as const;

interface LadderProps {
  /** The rung the penalty is on. */
  rung: number;
  /** It was answered through: its rung is passed, the next one waits. */
  passed: boolean;
}

/** The four rungs, the ones passed ticked and the one it is on lit. */
function Ladder({ rung, passed }: LadderProps): ReactNode {
  const { t } = useTranslation();
  return (
    <ol
      aria-label={t("books.sitting.penalty.rungs")}
      className="flex h-36 w-full max-w-sm items-end gap-2"
    >
      {RUNGS.map((reps, at) => {
        const step = at + 1;
        const done = step < rung || (passed && step === rung);
        const now = !passed && step === rung;
        const label = done
          ? "books.sitting.penalty.rungDone"
          : now
            ? "books.sitting.penalty.rungNow"
            : "books.sitting.penalty.rung";
        return (
          <Reveal
            key={reps}
            as="li"
            kind="scale"
            aria-label={t(label, { reps })}
            className={cn(
              "flex flex-1 items-end justify-center rounded-lg border-2 pb-2 font-mono text-sm font-bold transition-colors duration-300",
              HEIGHTS[at],
              done && "border-correct bg-correct-soft text-correct",
              now && "border-book bg-book text-canvas",
              !done && !now && "border-line-strong text-ink-faint",
              passed && step === rung + 1 && "border-dashed",
            )}
          >
            <Presence swap>
              <Reveal key={done ? "done" : "reps"} as="span" kind="fade">
                {done ? (
                  <Check aria-hidden className="size-4" />
                ) : (
                  <span aria-hidden>{`${String(reps)} + ${String(reps)}`}</span>
                )}
              </Reveal>
            </Presence>
          </Reveal>
        );
      })}
    </ol>
  );
}

/** The colour of a way, in the count: each one its own. */
const WAY: Record<Direction, string> = {
  recognition: "border-recognition bg-recognition",
  production: "border-production bg-production",
};

interface CountProps {
  penalty: PenaltyStep;
}

/**
 * How far the penalty is: the number, and a dot for each one it asks, the
 * ones answered in the colour of the way they were asked. The ones to come
 * are all alike: they do not say which way comes next.
 */
function Count({ penalty }: CountProps): ReactNode {
  const { t } = useTranslation();
  const total = penalty.reps * 2;
  const done = penalty.answered.length;
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="font-display text-display font-light tracking-tight text-ink tabular-nums">
        <span className="sr-only">
          {t("books.sitting.penalty.count", { done, total })}
        </span>
        <span aria-hidden>
          <CountUp value={done} />
          <span className="text-ink-faint">{` / ${String(total)}`}</span>
        </span>
      </p>
      <ol aria-hidden className="flex max-w-md flex-wrap justify-center gap-2">
        {Array.from({ length: total }, (_, at) => {
          const way = penalty.answered[at];
          return (
            <li
              key={at}
              className={cn(
                "size-3 rounded-full border-2 transition-colors duration-300",
                way === undefined ? "border-line-strong" : WAY[way],
                at === done && "animate-breathe border-book",
              )}
            />
          );
        })}
      </ol>
    </div>
  );
}

interface PenaltyRunProps {
  sittingId: string;
  penalty: PenaltyStep;
  nativeLang: string;
  /** What the penalty says next: its next question, or the session's. */
  onStep: (step: PracticeStep) => void;
}

type Phase =
  | { name: "intro" }
  | { name: "drill" }
  /** It was answered through: the session goes on with `next`. */
  | { name: "through"; next: PracticeStep };

/**
 * A penalty review: a word missed three times in a row, asked on its own
 * until it is answered right every time in a row, each way, in an order the
 * learner cannot see coming (`books::penalty`). The whole window turns to a
 * night of its own while it lasts (`[data-penalty]`), so it is never taken
 * for the usual practice.
 *
 * It opens on what it asks and the rung it is on; one already under way
 * opens there too, since a penalty left halfway starts over. Each question
 * is asked with the form of the usual practice, with no hint, no "I know
 * this" and no "I was right"; a miss starts it over and says where it was.
 * Answered through, it shows the rung passed and what the next would ask.
 *
 * It stays on the screen from its first question to its last: what a
 * question shows is swapped inside it.
 */
export function PenaltyRun({
  sittingId,
  penalty,
  nativeLang,
  onStep,
}: PenaltyRunProps): ReactNode {
  const { t, i18n } = useTranslation();
  const [phase, setPhase] = useState<Phase>(
    penalty.answered.length === 0 ? { name: "intro" } : { name: "drill" },
  );
  /** Each question its own form, even when a restart asks the same again. */
  const [turn, setTurn] = useState(0);
  /** Where a miss caught it: said over the next question. */
  const [restartedAt, setRestartedAt] = useState<number | null>(null);
  const last = useRef<PenaltyAnswer | null>(null);
  const native = languageName(nativeLang, i18n.language);
  const total = penalty.reps * 2;

  let content: ReactNode;
  if (phase.name === "intro") {
    content = (
      <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 px-6 pt-4 pb-12 text-center">
        <Reveal as="p" className="text-sm font-semibold text-book">
          {t("books.sitting.penalty.resists")}
        </Reveal>
        <Reveal as="div" className="flex flex-col items-center gap-1">
          <h1 className="font-display text-display font-light tracking-tight text-ink">
            {penalty.english}
          </h1>
          <p className="text-lead text-ink-soft">{penalty.native}</p>
        </Reveal>
        <Ladder rung={penalty.rung} passed={false} />
        <Reveal as="p" className="text-ink-soft">
          {t("books.sitting.penalty.ask", {
            total,
            reps: penalty.reps,
            native,
          })}
        </Reveal>
        <Reveal
          as="div"
          className="flex flex-wrap items-center justify-center gap-3"
        >
          <Button
            variant="primaryBook"
            autoFocus
            onClick={() => {
              setPhase({ name: "drill" });
            }}
          >
            {t("books.sitting.start")}
          </Button>
        </Reveal>
      </section>
    );
  } else if (phase.name === "through") {
    const { next } = phase;
    const top = penalty.rung >= TOP;
    const reps = RUNGS[Math.min(penalty.rung, TOP - 1)] ?? penalty.reps;
    content = (
      <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-6 px-6 pt-4 pb-12 text-center">
        <Reveal>
          <VerdictLine tone="right">
            {t("books.sitting.penalty.through", { total })}
          </VerdictLine>
        </Reveal>
        <Ladder rung={penalty.rung} passed />
        <Reveal as="p" className="text-ink-soft">
          {t(top ? "books.sitting.penalty.top" : "books.sitting.penalty.next", {
            word: penalty.english,
            reps,
          })}
        </Reveal>
        <Reveal as="div">
          <Button
            variant="primaryBook"
            autoFocus
            onClick={() => {
              onStep(next);
            }}
          >
            {t("books.sitting.penalty.back")}
          </Button>
        </Reveal>
      </section>
    );
  } else {
    content = (
      <div className="flex flex-col items-center gap-2">
        <Reveal className="pt-2">
          <Count penalty={penalty} />
        </Reveal>
        <Presence>
          {restartedAt !== null && (
            <Reveal key={`restart-${String(turn)}`} className="px-6">
              <VerdictLine tone="wrong">
                {t("books.sitting.penalty.again", { at: restartedAt })}
              </VerdictLine>
            </Reveal>
          )}
        </Presence>
        <Presence swap>
          <Reveal key={turn} className="w-full">
            <SittingItem<PenaltyAnswer>
              nativeLang={nativeLang}
              item={penalty.item}
              check={(answer, second, _hinted, rung) =>
                answerPenalty(sittingId, penalty.item, answer, second, rung)
              }
              know={null}
              dispute={null}
              notice={null}
              onAnswered={(result) => {
                last.current = result;
              }}
              onDispute={null}
              onNext={(next) => {
                const result = last.current;
                last.current = null;
                setTurn((held) => held + 1);
                if (result?.finished === true) {
                  setPhase({ name: "through", next });
                  return;
                }
                setRestartedAt(
                  result?.restarted === true
                    ? penalty.answered.length + 1
                    : null,
                );
                onStep(next);
              }}
            />
          </Reveal>
        </Presence>
      </div>
    );
  }

  return (
    <Presence swap>
      <Reveal
        key={phase.name}
        className="flex min-h-full min-w-0 flex-col justify-center"
      >
        {content}
      </Reveal>
    </Presence>
  );
}
