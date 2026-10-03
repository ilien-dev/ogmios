import { useState } from "react";
import type { SyntheticEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Lightbulb, Repeat } from "lucide-react";
import type { CorrectionCard } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { TextInput } from "@/components/ui/TextInput";
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
        <p className="flex items-center gap-2 text-sm text-partial">
          <Repeat aria-hidden className="size-4" />
          {card.recurrence}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-faint">
          {t("report.correction.yourSentence")}
        </p>
        <p className={cn("text-ink", compact ? "text-base" : "text-lead")}>
          <Highlighted text={card.original} spans={[card.highlight]} />
        </p>
      </div>

      {phase === "revealed" ? (
        <div
          className="flex flex-col gap-3 motion-safe:animate-rise"
          aria-live="polite"
        >
          {outcome !== null && (
            <VerdictLine tone={outcome}>{t(VERDICT[outcome])}</VerdictLine>
          )}
          <div className="flex flex-col gap-1 rounded-lg bg-correct-soft px-5 py-4">
            <p className="text-sm text-ink-faint">
              {t("report.correction.better")}
            </p>
            <p
              className={cn(
                "font-medium text-ink",
                compact ? "text-base" : "text-lead",
              )}
            >
              {card.corrected}
            </p>
          </div>
          <p className="leading-relaxed text-ink-soft">{card.explanation}</p>
        </div>
      ) : (
        <form
          onSubmit={(event) => void check(event)}
          className="flex flex-col gap-3"
        >
          <label htmlFor={inputId} className="font-medium text-ink">
            {t("report.correction.fixPrompt")}
          </label>
          <div className="flex gap-2">
            <TextInput
              id={inputId}
              value={attempt}
              spellCheck={false}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
            />
            <Button
              type="submit"
              variant="primary"
              className="h-11"
              disabled={checking || attempt.trim() === ""}
            >
              {checking ? (
                <Spinner className="text-on-accent" />
              ) : (
                t("report.correction.check")
              )}
            </Button>
          </div>
          <div aria-live="polite">
            {phase === "hint" && hint !== null && (
              <p className="flex items-center gap-2 text-sm text-ink motion-safe:animate-fade">
                <Lightbulb aria-hidden className="size-4 text-partial" />
                {t("report.correction.hint", { hint })}
              </p>
            )}
          </div>
          {failure !== null && (
            <p role="alert" className="text-sm text-danger">
              {t("common.error", { message: failure })}
            </p>
          )}
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
      )}
      <div className="flex justify-end">
        <DisputeButton itemId={card.itemId} />
      </div>
    </div>
  );
}
