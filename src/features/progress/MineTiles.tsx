import { Clock, Layers, WholeWord, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MINE_TABS } from "@/app/routes";
import type { MineTab } from "@/app/routes";
import { Tilt } from "@/components/motion/Tilt";
import { BigNumber } from "@/components/scene/Stats";
import { cn } from "@/lib/cn";

const ICON: Record<MineTab, LucideIcon> = {
  words: WholeWord,
  patterns: Zap,
  structures: Layers,
  time: Clock,
};

interface MineTilesProps {
  /** The one whose board and scene are on the screen. */
  tab: MineTab;
  /** What each one counts: words, patterns, structures, minutes this week. */
  counts: Record<MineTab, number>;
  onPick: (tab: MineTab) => void;
}

/**
 * What the learner has gathered, a glass tile each with its count in big:
 * they lean towards the pointer, and pressing one puts its board and its
 * scene on the screen.
 */
export function MineTiles({ tab, counts, onPick }: MineTilesProps): ReactNode {
  const { t } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t("progress.tabsLabel")}
      className="grid grid-cols-2 gap-3"
    >
      {MINE_TABS.map((each) => {
        const Icon = ICON[each];
        const on = each === tab;
        return (
          <Tilt key={each}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => {
                onPick(each);
              }}
              className={cn(
                "group flex w-full flex-col gap-5 rounded-xl glass px-5 pt-4.5 pb-4 text-left transition-control hover:shadow-lift",
                on && "ring-1 ring-accent/50",
              )}
            >
              <span className="flex size-6 items-center justify-center">
                <Icon
                  aria-hidden
                  className={cn(
                    "size-6 transition-transform duration-300 ease-out-expo group-hover:scale-115 group-hover:-rotate-6",
                    on ? "text-accent-text" : "text-ink-faint",
                  )}
                />
              </span>
              <span className="flex items-end justify-between gap-2">
                <span className="text-sm text-ink-soft">
                  {t(`progress.tabs.${each}`)}
                </span>
                <BigNumber
                  value={counts[each]}
                  size="md"
                  className={cn(
                    "transition-control",
                    on ? "text-accent-text" : "text-ink",
                  )}
                />
              </span>
            </button>
          </Tilt>
        );
      })}
    </div>
  );
}
