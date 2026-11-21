import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Dumbbell, MessageCircle } from "lucide-react";
import { Magnetic } from "@/components/motion/Magnetic";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { Button } from "@/components/ui/Button";
import type { Navigate } from "@/app/routes";

interface ClosingCardProps {
  focusPatternId: string | null;
  /** Whether the report had no cards at all. */
  empty: boolean;
  navigate: Navigate;
  onDone: () => void;
}

/** The app's last card: what is saved, and where to go from here. */
export function ClosingCard({
  focusPatternId,
  empty,
  navigate,
  onDone,
}: ClosingCardProps): ReactNode {
  const { t } = useTranslation();
  return (
    <Stagger className="flex flex-col gap-6">
      <Reveal as="p" className="text-lead text-ink-soft">
        {empty ? t("report.empty") : t("report.closing.body")}
      </Reveal>
      <Reveal className="flex flex-wrap items-center gap-3">
        <Presence>
          {focusPatternId !== null && (
            <Reveal key="focusPatternId" as="span" kind="fade">
              <Magnetic>
                <Button
                  variant="primary"
                  size="lg"
                  className="group"
                  icon={
                    <Dumbbell
                      aria-hidden
                      className="size-5 transition-transform duration-300 ease-out-expo group-hover:-rotate-12"
                    />
                  }
                  onClick={() => {
                    navigate({
                      name: "practice",
                      patternId: focusPatternId,
                      format: null,
                    });
                  }}
                >
                  {t("report.closing.practise")}
                </Button>
              </Magnetic>
            </Reveal>
          )}
        </Presence>
        <Button
          className="group"
          icon={
            <MessageCircle
              aria-hidden
              className="size-4 transition-transform duration-300 ease-out-expo group-hover:scale-110"
            />
          }
          onClick={() => {
            navigate({ name: "setup", preset: null });
          }}
        >
          {t("report.closing.another")}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("report.closing.done")}
        </Button>
      </Reveal>
    </Stagger>
  );
}
