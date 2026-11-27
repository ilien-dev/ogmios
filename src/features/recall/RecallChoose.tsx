import { useEffect, useId, useState } from "react";
import type { ReactNode, SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import type { SessionSize, Ways } from "@shared/domain";
import type { RecallOptions, RecallPlan, WordEffort } from "@shared/recall";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Dialog } from "@/components/ui/Dialog";
import { SittingFrame, SittingWait } from "@/features/books/SittingParts";
import { RunBackdrop } from "@/features/drills/ScreenParts";
import { errorMessage } from "@/lib/errors";
import { recallOptions } from "@/lib/ipc";
import { languageName } from "@/lib/text";
import { EffortBars } from "./EffortBars";

/** How every due word of an effort is named among its sizes. */
const ALL = "all";

/** A size as a choice names it. */
function keyOf(size: SessionSize): string {
  return size.size === null ? ALL : String(size.size);
}

/** The effort chosen until the learner picks one: the hardest with words. */
function firstEffort(options: RecallOptions): WordEffort {
  return (
    options.efforts.find((each) => each.due > 0)?.effort ??
    options.efforts[0]?.effort ??
    "hard"
  );
}

interface ChooseProps {
  options: RecallOptions;
  ways: Ways;
  nativeLang: string;
  onWays: (ways: Ways) => void;
  onStart: (plan: RecallPlan) => void;
}

/** The choices, once what is due is known. */
function Choose({
  options,
  ways,
  nativeLang,
  onWays,
  onStart,
}: ChooseProps): ReactNode {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const [picked, setPicked] = useState<WordEffort | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [rules, setRules] = useState(false);
  const [everything, setEverything] = useState(false);

  const effort =
    picked !== null &&
    options.efforts.some((each) => each.effort === picked && each.due > 0)
      ? picked
      : firstEffort(options);
  const sizes =
    options.efforts.find((each) => each.effort === effort)?.sizes ?? [];
  const size =
    sizes.find((each) => keyOf(each) === chosen) ?? sizes.at(0) ?? null;
  const name = t(`recall.effort.${effort}.name`);
  const english = languageName("en", i18n.language);
  const native = languageName(nativeLang, i18n.language);

  const start = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (size !== null && size.words > 0) {
      onStart({ ways, effort, size: size.size });
    }
  };

  return (
    <div className="grid min-h-full place-items-center px-10 py-6">
      <form
        onSubmit={start}
        className="flex w-full max-w-3xl flex-col items-start gap-7"
      >
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-display font-light tracking-tight text-ink">
            {t("recall.choose.title")}
          </h1>
          <p className="text-ink-soft">
            {t("recall.choose.lead", { count: options.all.words })}
          </p>
        </div>

        <div className="flex w-full flex-col gap-2">
          <ChoiceGroup<WordEffort>
            legend={t("recall.choose.which")}
            columns={3}
            value={effort}
            onChange={(next) => {
              setPicked(next);
              setChosen(null);
            }}
            choices={options.efforts.map((each) => ({
              value: each.effort,
              label: t(`recall.effort.${each.effort}.name`),
              badge: String(each.due),
              mark: <EffortBars effort={each.effort} />,
              description:
                each.due > 0
                  ? `${t(`recall.effort.${each.effort}.rule`)}. ${t(`recall.effort.${each.effort}.hint`)}`
                  : t("recall.choose.none"),
              disabled: each.due === 0,
            }))}
          />
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            aria-expanded={rules}
            onClick={() => {
              setRules((open) => !open);
            }}
          >
            {t("recall.choose.how")}
          </Button>
          <Presence>
            {rules && (
              <Reveal
                key="rules"
                as="p"
                className="max-w-2xl text-sm text-ink-soft"
              >
                {t("recall.choose.rules")}
              </Reveal>
            )}
          </Presence>
        </div>

        <div className="grid w-full gap-7 wide:grid-cols-2">
          <ChoiceGroup
            legend={t("recall.choose.howMany", { name })}
            columns={2}
            value={size === null ? null : keyOf(size)}
            onChange={setChosen}
            choices={sizes.map((each) => ({
              value: keyOf(each),
              label:
                each.size === null
                  ? t("books.sitting.sizeAll", { count: each.words })
                  : t("books.sitting.sizeWords", { count: each.words }),
              description: t("books.sitting.sizeMinutes", {
                count: each.minutes,
              }),
            }))}
          />
          <ChoiceGroup<Ways>
            legend={t("books.sitting.ways")}
            size="sm"
            value={ways}
            onChange={onWays}
            choices={[
              { value: "both", label: t("books.sitting.waysBoth") },
              {
                value: "recognition",
                label: t("books.sitting.direction", {
                  from: english,
                  to: native,
                }),
              },
              {
                value: "production",
                label: t("books.sitting.direction", {
                  from: native,
                  to: english,
                }),
              },
            ]}
          />
        </div>

        <div className="flex w-full flex-wrap items-center justify-between gap-4">
          <Button
            type="submit"
            variant="primary"
            disabled={size === null || size.words === 0}
          >
            {t("recall.start")}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setEverything(true);
            }}
          >
            {t("recall.choose.everything")}
            <span className="rounded-full bg-tally-soft px-1.5 font-mono text-xs font-semibold text-tally">
              {options.all.words}
            </span>
          </Button>
        </div>
      </form>

      <Dialog
        open={everything}
        labelledBy={titleId}
        onClose={() => {
          setEverything(false);
        }}
      >
        <h2
          id={titleId}
          className="font-display text-lead font-medium tracking-tight text-ink"
        >
          {t("recall.everything.title")}
        </h2>
        <p className="text-sm text-ink-soft">
          {t("recall.everything.lead", {
            count: options.all.words,
            minutes: options.all.minutes,
          })}
        </p>
        <ul className="flex flex-col divide-y divide-line rounded-md bg-surface shadow-card">
          {options.efforts.map((each) => (
            <li
              key={each.effort}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-ink"
            >
              <EffortBars effort={each.effort} />
              <span className="flex-1">
                {t(`recall.effort.${each.effort}.name`)}
              </span>
              <span className="font-mono text-ink-soft tabular-nums">
                {each.due}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink">{t("recall.everything.ask")}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            onClick={() => {
              onStart({ ways, effort: null, size: null });
            }}
          >
            {t("recall.everything.go", { count: options.all.words })}
          </Button>
          <Button
            variant="primary"
            data-autofocus
            onClick={() => {
              setEverything(false);
            }}
          >
            {t("recall.everything.parts")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

interface RecallChooseProps {
  /** The ways chosen already, as where it was opened from had them. */
  ways: Ways;
  nativeLang: string;
  onStart: (plan: RecallPlan) => void;
  onLeave: () => void;
}

/**
 * Where a run of the daily review's words is chosen before it starts: the
 * words of one effort (the ones that cost the most, those won with some
 * misses, those never missed), how many of them, and which way they are
 * asked, each size with about how long it takes. Every word due at once is
 * there too, after saying how many that is. The hardest effort with words
 * and its smallest size are chosen already, so Enter alone begins.
 */
export function RecallChoose({
  ways: initial,
  nativeLang,
  onStart,
  onLeave,
}: RecallChooseProps): ReactNode {
  const { t } = useTranslation();
  const [ways, setWays] = useState<Ways>(initial);
  const [options, setOptions] = useState<RecallOptions | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    recallOptions(ways)
      .then((found) => {
        if (live) {
          setOptions(found);
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setFailure(errorMessage(error));
        }
      });
    return () => {
      live = false;
    };
  }, [ways]);

  return (
    <RunBackdrop>
      <SittingFrame leave={t("recall.leave")} progress={null} onClose={onLeave}>
        <Presence swap>
          {options === null || failure !== null ? (
            <Reveal key="wait" kind="fade" className="h-full">
              <SittingWait failure={failure} />
            </Reveal>
          ) : (
            <Reveal key="choose" className="h-full overflow-y-auto">
              <Choose
                options={options}
                ways={ways}
                nativeLang={nativeLang}
                onWays={setWays}
                onStart={onStart}
              />
            </Reveal>
          )}
        </Presence>
      </SittingFrame>
    </RunBackdrop>
  );
}
