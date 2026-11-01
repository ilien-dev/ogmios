import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ThumbsDown } from "lucide-react";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { disputeItem } from "@/lib/ipc";

/**
 * "I disagree" (§7): the item stops counting towards the learner's memory.
 * Protects trust against the model's false positives.
 */
export function DisputeButton({ itemId }: { itemId: string }): ReactNode {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");

  return (
    <Presence swap>
      {state === "done" ? (
        <Reveal
          key="done"
          as="p"
          kind="fade"
          index={0}
          role="status"
          className="flex items-center gap-1.5 text-sm text-ink-soft"
        >
          <Check aria-hidden className="size-4" />
          {t("report.correction.disputed")}
        </Reveal>
      ) : (
        <Reveal key="ask" as="span" kind="fade" index={0}>
          <Button
            size="sm"
            variant="ghost"
            disabled={state === "sending"}
            icon={<ThumbsDown aria-hidden className="size-3.5" />}
            onClick={() => {
              setState("sending");
              disputeItem(itemId)
                .then(() => {
                  setState("done");
                })
                .catch(() => {
                  setState("idle");
                });
            }}
          >
            {t("report.correction.disagree")}
          </Button>
        </Reveal>
      )}
    </Presence>
  );
}
