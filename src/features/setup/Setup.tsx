import { useEffect, useState } from "react";
import type { SyntheticEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import type {
  FocusMode,
  Level,
  Mode,
  Personality,
  Profile,
  SessionSetup,
} from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Magnetic } from "@/components/motion/Magnetic";
import { Stagger } from "@/components/motion/Stagger";
import { Scene, SceneTitle } from "@/components/scene/Scene";
import { SpiralRelief } from "@/components/scene/SpiralRelief";
import { StatChip } from "@/components/scene/Stats";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { TextArea } from "@/components/ui/TextArea";
import type { Navigate } from "@/app/routes";
import { cn } from "@/lib/cn";
import { homeState } from "@/lib/ipc";

export const TOPIC_MAX = 200;

const LEVELS = ["basic", "intermediate", "advanced"] as const;
const MODES = [
  "casual",
  "interview",
  "debate",
  "story",
  "roleplay",
  "material",
] as const;
const PERSONALITIES = [
  "curiousFriend",
  "strictInterviewer",
  "coworker",
  "contrarian",
] as const;
const TARGETS = ["5", "10", "20", "none"] as const;

/** A choice in the column, on its own glass. */
const CARD = "flex flex-col rounded-xl glass p-5";

interface SetupProps {
  profile: Profile;
  preset: Partial<SessionSetup> | null;
  navigate: Navigate;
}

function initialSetup(profile: Profile): SessionSetup {
  return {
    topic: "",
    level: profile.level,
    mode: "casual",
    personality: "curiousFriend",
    focusMode: "free",
    targetMinutes: 10,
    material: null,
    continuePrevious: false,
  };
}

/** §6.2: the full set-up. Starts from the last one the learner used. */
export function Setup({ profile, preset, navigate }: SetupProps): ReactNode {
  const { t } = useTranslation();
  const [setup, setSetup] = useState<SessionSetup>(() => ({
    ...initialSetup(profile),
    ...preset,
  }));
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [problem, setProblem] = useState<"topic" | "material" | null>(null);

  useEffect(() => {
    let live = true;
    void homeState().then((home) => {
      if (!live) {
        return;
      }
      setSuggestions(home.suggestedTopics);
      if (home.lastSetup !== null) {
        const last = home.lastSetup;
        // The topic is the one thing not repeated: suggestions start with
        // one the learner has not just talked about.
        const topic = home.suggestedTopics[0] ?? last.topic;
        setSetup((held) => ({ ...held, ...last, topic, ...preset }));
      }
    });
    return () => {
      live = false;
    };
  }, [preset]);

  const patch = (next: Partial<SessionSetup>): void => {
    setSetup((held) => ({ ...held, ...next }));
    setProblem(null);
  };

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const topic = setup.topic.trim();
    const material = setup.material?.trim() ?? "";
    if (topic === "") {
      setProblem("topic");
      return;
    }
    if (setup.mode === "material" && material === "") {
      setProblem("material");
      return;
    }
    navigate({
      name: "conversation",
      setup: {
        ...setup,
        topic,
        material: setup.mode === "material" ? material : null,
      },
    });
  };

  const minutes =
    setup.targetMinutes === null
      ? t("setup.targetNone")
      : t("common.minutes", { count: setup.targetMinutes });
  return (
    <main className="h-full overflow-y-auto">
      <form
        onSubmit={submit}
        noValidate
        className="flex min-h-full flex-col gap-4 pt-2 pb-4 wide:h-full wide:flex-row"
      >
        <Stagger className="flex w-full shrink-0 flex-col gap-3.5 wide:max-w-md wide:overflow-y-auto wide:pb-2">
          <Reveal className={CARD}>
            <ChoiceGroup<Level>
              legend={t("setup.level")}
              columns={3}
              size="sm"
              value={setup.level}
              onChange={(level) => {
                patch({ level });
              }}
              choices={LEVELS.map((value) => ({
                value,
                label: t(`level.${value}`),
              }))}
            />
          </Reveal>

          <Reveal className={CARD}>
            <ChoiceGroup<Mode>
              legend={t("setup.mode")}
              columns={3}
              size="sm"
              value={setup.mode}
              onChange={(mode) => {
                patch({ mode });
              }}
              choices={MODES.map((value) => ({
                value,
                label: t(`mode.${value}`),
              }))}
            />
          </Reveal>

          <Presence>
            {setup.mode === "material" && (
              <Reveal key="material" className={CARD}>
                <Field
                  id="material"
                  label={t("setup.material")}
                  error={
                    problem === "material" ? t("setup.materialRequired") : null
                  }
                >
                  <TextArea
                    id="material"
                    rows={7}
                    placeholder={t("setup.materialPlaceholder")}
                    aria-invalid={problem === "material"}
                    value={setup.material ?? ""}
                    onChange={(event) => {
                      patch({ material: event.target.value });
                    }}
                  />
                </Field>
              </Reveal>
            )}
          </Presence>

          <Reveal className={CARD}>
            <ChoiceGroup<Personality>
              legend={t("setup.personality")}
              columns={2}
              size="sm"
              value={setup.personality}
              onChange={(personality) => {
                patch({ personality });
              }}
              choices={PERSONALITIES.map((value) => ({
                value,
                label: t(`personality.${value}`),
              }))}
            />
          </Reveal>

          <Reveal className={CARD}>
            <ChoiceGroup<FocusMode>
              legend={t("setup.focus")}
              columns={2}
              value={setup.focusMode}
              onChange={(focusMode) => {
                patch({ focusMode });
              }}
              choices={(["free", "pending"] as const).map((value) => ({
                value,
                label: t(`focusMode.${value}`),
                description: t(`focusMode.${value}Hint`),
              }))}
            />
          </Reveal>

          <Reveal className={cn(CARD, "gap-2")}>
            <ChoiceGroup<(typeof TARGETS)[number]>
              legend={t("setup.target")}
              columns={4}
              size="sm"
              value={
                setup.targetMinutes === null
                  ? "none"
                  : (TARGETS.find((v) => v === String(setup.targetMinutes)) ??
                    "10")
              }
              onChange={(value) => {
                patch({
                  targetMinutes: value === "none" ? null : Number(value),
                });
              }}
              choices={TARGETS.map((value) => ({
                value,
                label:
                  value === "none"
                    ? t("setup.targetNone")
                    : t("common.minutes", { count: Number(value) }),
              }))}
            />
            <p className="text-sm text-ink-faint">{t("setup.targetHint")}</p>
          </Reveal>
        </Stagger>

        <Reveal kind="fade" className="flex min-h-160 min-w-0 flex-1 flex-col">
          <Scene
            label={t("setup.scene")}
            className="flex-1"
            header={
              <>
                <SceneTitle>{t("setup.title")}</SceneTitle>
                <div className="flex max-w-2xl flex-col gap-3 rounded-xl glass p-5">
                  <Field
                    id="topic"
                    label={t("setup.topic")}
                    error={
                      problem === "topic" ? t("setup.topicRequired") : null
                    }
                    hint={t("setup.topicCount", {
                      count: setup.topic.length,
                      max: TOPIC_MAX,
                    })}
                  >
                    <TextArea
                      id="topic"
                      rows={2}
                      maxLength={TOPIC_MAX}
                      placeholder={t("setup.topicPlaceholder")}
                      aria-invalid={problem === "topic"}
                      aria-describedby="topic-hint"
                      value={setup.topic}
                      onChange={(event) => {
                        patch({ topic: event.target.value });
                      }}
                    />
                  </Field>
                  <Presence>
                    {suggestions.length > 0 && (
                      <Reveal
                        key="suggestions"
                        role="group"
                        aria-label={t("setup.suggestions")}
                        index={0}
                        className="flex flex-wrap gap-2"
                      >
                        {suggestions.map((suggestion) => (
                          <Chip
                            key={suggestion}
                            selected={setup.topic === suggestion}
                            onClick={() => {
                              patch({ topic: suggestion });
                            }}
                          >
                            {suggestion}
                          </Chip>
                        ))}
                      </Reveal>
                    )}
                  </Presence>
                </div>
              </>
            }
            footer={
              <Reveal className="flex flex-wrap items-center justify-between gap-4 rounded-xl glass px-5.5 py-4.5">
                <div className="flex flex-wrap gap-2">
                  <StatChip value={t(`level.${setup.level}`)} tone="accent">
                    {t(`mode.${setup.mode}`)}
                  </StatChip>
                  <StatChip value={minutes}>
                    {t(`personality.${setup.personality}`)}
                  </StatChip>
                </div>
                <Magnetic>
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    className="group"
                  >
                    {t("setup.start")}
                    <ArrowRight
                      aria-hidden
                      className="size-5 transition-transform duration-300 ease-out-expo group-hover:translate-x-1"
                    />
                  </Button>
                </Magnetic>
              </Reveal>
            }
          >
            <SpiralRelief
              label={t("setup.relief")}
              className="size-full max-w-3xl px-6 pt-72 pb-32"
            />
          </Scene>
        </Reveal>
      </form>
    </main>
  );
}
