import { motion, useIsPresent, useReducedMotionConfig } from "motion/react";
import type { Variants } from "motion/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Flag, Sparkles, TrendingUp } from "lucide-react";
import type { HomeState } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Button } from "@/components/ui/Button";
import type { Navigate } from "@/app/routes";
import { DURATION, EASE_OUT, REVEAL, animated } from "@/lib/motion";
import type { TodayKind } from "./homeLayout";
import { todayLines } from "./homeLayout";

const ICONS = { challenge: Flag, rotation: Sparkles, level: TrendingUp };

const FOLD: Variants = {
  hidden: { height: 0, opacity: 0 },
  shown: {
    height: "auto",
    opacity: 1,
    transition: { duration: DURATION.enter, ease: EASE_OUT },
  },
  gone: {
    height: 0,
    opacity: 0,
    transition: { duration: DURATION.exit, ease: EASE_OUT },
  },
};

interface LineProps {
  kind: TodayKind;
  home: HomeState;
  topic: string;
  navigate: Navigate;
}

/** A sentence for today, and the way to act on it if it has one. */
function Line({ kind, home, topic, navigate }: LineProps): ReactNode {
  const { t } = useTranslation();
  const Icon = ICONS[kind];
  const mode = home.rotationSuggestion ?? "casual";
  const level = home.levelSuggestion ?? "intermediate";
  const lines = {
    challenge: {
      text: t("home.challenge", { text: home.activeChallenge ?? "" }),
      action: null,
    },
    rotation: {
      text: t("home.rotation", { mode: t(`mode.${mode}`).toLowerCase() }),
      action: { label: t("home.tryIt"), preset: { topic, mode } },
    },
    level: {
      text: t("home.levelSuggestion", {
        level: t(`level.${level}`).toLowerCase(),
      }),
      action: { label: t("home.switchLevel"), preset: { topic, level } },
    },
  };
  const { text, action } = lines[kind];
  return (
    <p className="flex min-w-0 items-center gap-2 text-left text-sm text-ink-soft">
      <Icon aria-hidden className="size-4 shrink-0 text-ink-faint" />
      <span className="min-w-0">{text}</span>
      {action !== null && (
        <button
          type="button"
          onClick={() => {
            navigate({ name: "setup", preset: action.preset });
          }}
          className="shrink-0 rounded-sm px-2 py-1 font-medium text-accent-text underline-offset-4 transition-control hover:underline"
        >
          {action.label}
        </button>
      )}
    </p>
  );
}

/** What unfolds under the first line. Fades alone where motion is reduced. */
function Fold({ children }: { children: ReactNode }): ReactNode {
  const present = useIsPresent();
  const reduced = useReducedMotionConfig();
  return (
    <motion.div
      variants={reduced === true ? REVEAL.fade : FOLD}
      custom={0}
      initial={animated() ? "hidden" : false}
      animate="shown"
      exit="gone"
      inert={!present}
      className="overflow-hidden"
    >
      <div className="flex flex-col items-center gap-1 pt-1">{children}</div>
    </motion.div>
  );
}

interface TodayLineProps {
  home: HomeState;
  topic: string;
  navigate: Navigate;
}

/** The first thing there is for today; `See more` unfolds the rest. */
export function TodayLine({
  home,
  topic,
  navigate,
}: TodayLineProps): ReactNode {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [first, ...rest] = todayLines(home);
  if (first === undefined) {
    return null;
  }
  const shared = { home, topic, navigate };
  return (
    <section aria-label={t("home.todayList")} className="w-full">
      <div className="flex flex-wrap items-center justify-center gap-x-2">
        <Line kind={first} {...shared} />
        {rest.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            aria-controls="today-more"
            onClick={() => {
              setOpen((held) => !held);
            }}
          >
            {t(open ? "home.seeLess" : "home.seeMore")}
          </Button>
        )}
      </div>
      <div id="today-more">
        <Presence>
          {open && (
            <Fold key="more">
              {rest.map((kind) => (
                <Line key={kind} kind={kind} {...shared} />
              ))}
            </Fold>
          )}
        </Presence>
      </div>
    </section>
  );
}
