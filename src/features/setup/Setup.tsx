import { useEffect, useState } from "react";
import type { SyntheticEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type {
  FocusMode,
  Level,
  Mode,
  Personality,
  Profile,
  SessionSetup,
} from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Chip } from "@/components/ui/Chip";
import { Field } from "@/components/ui/Field";
import { TextArea } from "@/components/ui/TextArea";
import type { Navigate } from "@/app/routes";
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
        setSetup((held) => ({ ...held, ...last, ...preset }));
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

  return (
    <main className="h-full overflow-y-auto">
      <form
        onSubmit={submit}
        noValidate
        className="mx-auto flex max-w-2xl flex-col gap-10 px-10 pt-12 pb-16"
      >
        <header className="flex flex-col items-start gap-6">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-3"
            icon={<ArrowLeft aria-hidden className="size-4" />}
            onClick={() => {
              navigate({ name: "home" });
            }}
          >
            {t("common.back")}
          </Button>
          <h1 className="text-title font-semibold text-ink">
            {t("setup.title")}
          </h1>
        </header>

        <div className="flex flex-col gap-3">
          <Field
            id="topic"
            label={t("setup.topic")}
            error={problem === "topic" ? t("setup.topicRequired") : null}
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
          {suggestions.length > 0 && (
            <div
              role="group"
              aria-label={t("setup.suggestions")}
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
            </div>
          )}
        </div>

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

        <ChoiceGroup<Mode>
          legend={t("setup.mode")}
          columns={3}
          size="sm"
          value={setup.mode}
          onChange={(mode) => {
            patch({ mode });
          }}
          choices={MODES.map((value) => ({ value, label: t(`mode.${value}`) }))}
        />

        {setup.mode === "material" && (
          <Field
            id="material"
            label={t("setup.material")}
            error={problem === "material" ? t("setup.materialRequired") : null}
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
        )}

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

        <div className="flex flex-col gap-2">
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
        </div>

        <div className="flex justify-end border-t border-line pt-6">
          <Button type="submit" variant="primary" size="lg">
            {t("setup.start")}
            <ArrowRight aria-hidden className="size-5" />
          </Button>
        </div>
      </form>
    </main>
  );
}
