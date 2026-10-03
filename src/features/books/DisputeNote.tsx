import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DisputeState } from "./sittingRun";

interface DisputeNoteProps {
  state: DisputeState;
  /** The answer it is about was given to a word the learner has left. */
  earlier?: boolean;
  /** Claude's reason may be shown: it does not answer the word on screen. */
  withReason?: boolean;
}

function wording(
  t: TFunction,
  { state, earlier = false, withReason = true }: DisputeNoteProps,
): string {
  switch (state.status) {
    case "pending":
      return t("books.sitting.judging");
    case "upheld":
      return earlier
        ? t("books.sitting.earlierUpheld")
        : t("books.sitting.upheld");
    case "failed":
      return earlier
        ? t("books.sitting.earlierFailed")
        : t("books.sitting.judgeFailed");
    case "rejected": {
      const told = withReason && state.reason !== "";
      if (earlier) {
        return told
          ? t("books.sitting.earlierRejected", { reason: state.reason })
          : t("books.sitting.earlierStands");
      }
      return told ? state.reason : t("books.sitting.stands");
    }
    default:
      return "";
  }
}

/**
 * How "I was right" went, in one quiet line: being asked, upheld, the reason
 * it was not, or that it could not be asked and the miss stands.
 */
export function DisputeNote(props: DisputeNoteProps): ReactNode {
  const { t } = useTranslation();
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-1.5 text-sm motion-safe:animate-rise",
        props.state.status === "upheld" ? "text-correct" : "text-ink-soft",
      )}
    >
      {props.state.status === "upheld" && (
        <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
      )}
      {wording(t, props)}
    </p>
  );
}
