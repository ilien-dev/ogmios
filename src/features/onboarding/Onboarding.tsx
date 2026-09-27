import { useEffect, useRef, useState } from "react";
import type { SyntheticEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Goal, Level, Profile, Settings, Variant } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import { ConnectionPanel } from "@/features/settings/ConnectionPanel";
import { VoiceModels } from "@/features/settings/VoiceModels";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { setUiLang } from "@/lib/i18n/i18n";
import { hasApiKey, saveProfile } from "@/lib/ipc";
import { NATIVE_LANGUAGES } from "@/lib/languages";
import { languageName } from "@/lib/text";
import { InterestPicker } from "./InterestPicker";
import { ReminderPicker } from "./ReminderPicker";

const STEPS = [
  "nativeLang",
  "name",
  "goal",
  "interests",
  "connection",
  "voice",
  "variant",
  "reminder",
  "level",
] as const;

type Step = (typeof STEPS)[number];

/** Steps 1 and 5 of §5: everything else may be skipped. */
const REQUIRED: ReadonlySet<Step> = new Set(["nativeLang", "connection"]);

const EMPTY_PROFILE: Profile = {
  name: null,
  nativeLang: "",
  uiLang: "en",
  goal: "work",
  variant: "us",
  interests: [],
  level: "intermediate",
  reminderTime: null,
  onboarded: false,
};

interface OnboardingProps {
  settings: Settings;
  onDone: (profile: Profile, settings: Settings) => void;
}

/** First launch (§5): one question per screen, nine screens. */
export function Onboarding({
  settings: initialSettings,
  onDone,
}: OnboardingProps): ReactNode {
  const { t, i18n } = useTranslation();
  const [index, setIndex] = useState(0);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [settings, setSettings] = useState(initialSettings);
  const [hasKey, setHasKey] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = STEPS[index] ?? "nativeLang";
  const last = index === STEPS.length - 1;

  useEffect(() => {
    let live = true;
    void hasApiKey().then((held) => {
      if (live) {
        setHasKey(held);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    heading.current?.focus();
  }, [index]);

  const patch = (next: Partial<Profile>): void => {
    setProfile((held) => ({ ...held, ...next }));
    setProblem(null);
  };

  const invalid = (): string | null => {
    if (step === "nativeLang" && profile.nativeLang === "") {
      return t("onboarding.nativeLang.required");
    }
    const connected =
      settings.providerMode === "apiKey"
        ? hasKey
        : settings.claudePath !== null;
    if (step === "connection" && !connected) {
      return t("onboarding.connection.required");
    }
    return null;
  };

  const finish = async (): Promise<void> => {
    const done: Profile = { ...profile, onboarded: true };
    setSaving(true);
    try {
      await saveProfile(done);
      onDone(done, settings);
    } catch (error) {
      setProblem(t("common.error", { message: errorMessage(error) }));
    } finally {
      setSaving(false);
    }
  };

  const advance = (): void => {
    if (last) {
      void finish();
      return;
    }
    setProblem(null);
    setIndex((held) => held + 1);
  };

  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const reason = invalid();
    if (reason === null) {
      advance();
    } else {
      setProblem(reason);
    }
  };

  const chooseNative = (code: string): void => {
    const uiLang = code === "es" ? "es" : "en";
    patch({ nativeLang: code, uiLang });
    setUiLang(uiLang);
  };

  const body: Record<Step, ReactNode> = {
    nativeLang: (
      <Field id="native" label={t("onboarding.nativeLang.field")}>
        <Select
          id="native"
          value={profile.nativeLang}
          aria-invalid={problem !== null}
          onChange={(event) => {
            chooseNative(event.target.value);
          }}
        >
          <option value="" disabled>
            {t("onboarding.nativeLang.choose")}
          </option>
          {NATIVE_LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {`${languageName(code, i18n.language)} · ${languageName(code, code)}`}
            </option>
          ))}
        </Select>
      </Field>
    ),
    name: (
      <Field
        id="name"
        label={t("onboarding.name.field")}
        hint={t("common.optional")}
      >
        <TextInput
          id="name"
          autoComplete="given-name"
          value={profile.name ?? ""}
          maxLength={60}
          onChange={(event) => {
            patch({
              name: event.target.value === "" ? null : event.target.value,
            });
          }}
        />
      </Field>
    ),
    goal: (
      <ChoiceGroup<Goal>
        legend={t("onboarding.goal.title")}
        hideLegend
        columns={2}
        value={profile.goal}
        onChange={(goal) => {
          patch({ goal });
        }}
        choices={(["work", "travel", "exams", "social", "other"] as const).map(
          (value) => ({ value, label: t(`goal.${value}`) }),
        )}
      />
    ),
    interests: (
      <InterestPicker
        value={profile.interests}
        onChange={(interests) => {
          patch({ interests });
        }}
      />
    ),
    connection: (
      <ConnectionPanel
        settings={settings}
        hasKey={hasKey}
        onSettingsChange={(next) => {
          setSettings(next);
          setProblem(null);
        }}
        onHasKeyChange={(held) => {
          setHasKey(held);
          setProblem(null);
        }}
      />
    ),
    voice: (
      <VoiceModels
        onSelected={(sttModel) => {
          setSettings((held) => ({ ...held, sttModel }));
        }}
      />
    ),
    variant: (
      <ChoiceGroup<Variant>
        legend={t("onboarding.variant.title")}
        hideLegend
        columns={2}
        value={profile.variant}
        onChange={(variant) => {
          patch({ variant });
        }}
        choices={(["us", "uk"] as const).map((value) => ({
          value,
          label: t(`variant.${value}`),
          description: t(`variant.${value}Example`),
        }))}
      />
    ),
    reminder: (
      <ReminderPicker
        value={profile.reminderTime}
        onChange={(reminderTime) => {
          patch({ reminderTime });
        }}
      />
    ),
    level: (
      <ChoiceGroup<Level>
        legend={t("onboarding.level.title")}
        hideLegend
        value={profile.level}
        onChange={(level) => {
          patch({ level });
        }}
        choices={(["basic", "intermediate", "advanced"] as const).map(
          (value) => ({
            value,
            label: t(`level.${value}`),
            description: t(`level.${value}Hint`),
          }),
        )}
      />
    ),
  };

  return (
    <main
      aria-label={t("onboarding.label")}
      className="flex h-full flex-col overflow-y-auto"
    >
      <form
        onSubmit={submit}
        noValidate
        className="mx-auto flex w-full max-w-xl flex-1 flex-col px-8 pt-16 pb-10"
      >
        <div className="flex items-center gap-4">
          <ol aria-hidden className="flex flex-1 gap-1.5">
            {STEPS.map((name, i) => (
              <li
                key={name}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors duration-300",
                  i <= index ? "bg-accent" : "bg-line",
                )}
              />
            ))}
          </ol>
          <p className="text-sm text-ink-faint tabular-nums">
            {t("onboarding.step", { current: index + 1, total: STEPS.length })}
          </p>
        </div>

        <div
          key={step}
          className="mt-14 flex flex-col gap-8 motion-safe:animate-rise"
        >
          <header className="flex flex-col gap-3">
            <h1
              ref={heading}
              tabIndex={-1}
              className="text-display font-semibold text-balance text-ink focus:outline-none"
            >
              {t(`onboarding.${step}.title`)}
            </h1>
            <p className="text-lead text-ink-soft">
              {t(`onboarding.${step}.body`)}
            </p>
          </header>
          {body[step]}
          {problem !== null && <Notice tone="danger">{problem}</Notice>}
        </div>

        <div className="mt-auto flex items-center gap-2 pt-12">
          {index > 0 && (
            <Button
              variant="ghost"
              icon={<ArrowLeft aria-hidden className="size-4" />}
              onClick={() => {
                setProblem(null);
                setIndex((held) => held - 1);
              }}
            >
              {t("common.back")}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {step === "voice" && (
              <Button variant="ghost" onClick={advance}>
                {t("voice.textOnly")}
              </Button>
            )}
            {!REQUIRED.has(step) && !last && step !== "voice" && (
              <Button variant="ghost" onClick={advance}>
                {t("common.skip")}
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={saving}>
              {last ? t("onboarding.finish") : t("common.next")}
              <ArrowRight aria-hidden className="size-4" />
            </Button>
          </div>
        </div>
      </form>
    </main>
  );
}
