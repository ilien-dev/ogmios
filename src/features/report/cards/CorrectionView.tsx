import { useState } from "react";
import type { SyntheticEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Lightbulb, Repeat } from "lucide-react";
import type { CorrectionCard } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { VerdictLine } from "@/components/ui/Verdict";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { grade } from "@/lib/grade";
import type { Grade } from "@/lib/grade";
import { selfCheck } from "@/lib/ipc";
import { DisputeButton } from "./DisputeButton";
import { Highlighted } from "./Highlighted";

type Phase = "ask" | "hint" | "revealed";

/** What each grade of the learner's own fix is called. */
const VERDICT = {
  right: "report.correction.fixedIt",
  partial: "report.correction.fixedWithHint",
  wrong: "report.correction.notFixed",
} as const;

interface CorrectionViewProps {
  card: CorrectionCard;
  compact?: boolean;
}

/**
 * One correction (§7.2). Rule-based errors ask first — the sentence, "Can
 * you fix it?", a hint after a miss, then the answer. Lexical ones show the
 * better version straight away.
 */
export function CorrectionView({
  card,
  compact = false,
}: CorrectionViewProps): ReactNode {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Phase>("ask");
  // Lexical errors skip the asking: the better version shows straight away.
  const phase = card.selfCorrect ? stage : "revealed";
  // Null until the learner types: the field starts from their own sentence.
  const [draft, setDraft] = useState<string | null>(null);
  const attempt = draft ?? card.original;
  const [checking, setChecking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  // How the learner's own fix went; null when the answer was only shown.
  const [outcome, setOutcome] = useState<Grade | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const inputId = `attempt-${card.itemId}`;

  const check = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    if (attempt.trim() === "") {
      return;
    }
    setChecking(true);
    setFailure(null);
    try {
      const result = await selfCheck(card.itemId, attempt.trim());
      if (!result.correct && phase === "ask") {
        setHint(result.hint ?? card.hint);
        setStage("hint");
      } else {
        setOutcome(grade(result.correct, phase === "hint"));
        setStage("revealed");
      }
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className={cn("flex flex-col", compact ? "gap-4" : "gap-6")}>
      {card.recurrence !== null && (
        <Reveal
          key="recurrence"
          as="p"
          className="flex items-center gap-2 text-sm text-partial"
        >
          <Repeat aria-hidden className="size-4" />
          {card.recurrence}
        </Reveal>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-ink-soft">
          {t("report.correction.yourSentence")}
        </p>
        <p
          className={cn(
            "leading-snug text-ink",
            compact ? "text-lead" : "text-2xl",
          )}
        >
          <Highlighted text={card.original} spans={[card.highlight]} />
        </p>
      </div>

      <div className="relative">
        <Presence swap>
          {phase === "revealed" ? (
            <Reveal
              key="revealed"
              index={0}
              aria-live="polite"
              className="flex flex-col gap-4"
            >
              <Presence>
                {outcome !== null && (
                  <Reveal key="outcome">
                    <VerdictLine tone={outcome}>
                      {t(VERDICT[outcome])}
                    </VerdictLine>
                  </Reveal>
                )}
              </Presence>
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-ink-soft">
                  {t("conversation.partner")} · {t("report.correction.better")}
                </p>
                <p
                  className={cn(
                    "font-medium text-ink",
                    compact ? "text-lg" : "text-2xl",
                  )}
                >
                  {card.corrected}
                </p>
              </div>
              <div className="flex flex-col gap-1.5 rounded-lg bg-raised px-5 py-4">
                <p className="text-sm font-semibold text-ink-soft">
                  {t("report.correction.why")}
                </p>
                <p className="leading-relaxed text-ink">{card.explanation}</p>
              </div>
            </Reveal>
          ) : (
            <Reveal
              key="ask"
              as="div"
              index={0}
              className="flex flex-col gap-3"
            >
              <form
                onSubmit={(event) => void check(event)}
                className="flex flex-col gap-3"
              >
                <label
                  htmlFor={inputId}
                  className="text-sm font-semibold text-ink-soft"
                >
                  {t("report.correction.fixPrompt")}
                </label>
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-raised p-1.5 pl-5">
                  <input
                    id={inputId}
                    value={attempt}
                    spellCheck={false}
                    className="h-11 min-w-48 flex-1 bg-transparent text-lead text-ink focus-visible:outline-none"
                    onChange={(event) => {
                      setDraft(event.target.value);
                    }}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    className="relative"
                    disabled={checking || attempt.trim() === ""}
                  >
                    <Presence swap>
                      <Reveal
                        key={checking ? "checking" : "check"}
                        as="span"
                        kind="fade"
                        index={0}
                      >
                        {checking ? <Spinner /> : t("report.correction.check")}
                      </Reveal>
                    </Presence>
                  </Button>
                </div>
                <div aria-live="polite">
                  <Presence>
                    {phase === "hint" && hint !== null && (
                      <Reveal
                        key="hint"
                        as="p"
                        kind="fade"
                        index={0}
                        className="flex items-center gap-2 text-sm text-ink"
                      >
                        <Lightbulb
                          aria-hidden
                          className="size-4 text-partial"
                        />
                        {t("report.correction.hint", { hint })}
                      </Reveal>
                    )}
                  </Presence>
                </div>
                <Presence>
                  {failure !== null && (
                    <Reveal
                      key="failure"
                      as="p"
                      index={0}
                      role="alert"
                      className="text-sm text-danger"
                    >
                      {t("common.error", { message: failure })}
                    </Reveal>
                  )}
                </Presence>
                <button
                  type="button"
                  onClick={() => {
                    setStage("revealed");
                  }}
                  className="self-start rounded-sm text-sm text-ink-soft underline underline-offset-4 hover:text-ink"
                >
                  {t("report.correction.showAnswer")}
                </button>
              </form>
            </Reveal>
          )}
        </Presence>
      </div>
      <div className="relative flex justify-end">
        <DisputeButton itemId={card.itemId} />
      </div>
    </div>
  );
}
