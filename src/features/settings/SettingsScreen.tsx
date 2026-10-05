import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Trash2, X } from "lucide-react";
import type {
  Goal,
  Level,
  Profile,
  Settings,
  UiLang,
  Variant,
} from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import { AppUpdate } from "@/features/update/AppUpdate";
import { InterestPicker } from "@/features/onboarding/InterestPicker";
import { ReminderPicker } from "@/features/onboarding/ReminderPicker";
import { errorMessage } from "@/lib/errors";
import {
  deleteProfileFact,
  deleteSessionAudio,
  hasApiKey,
  listProfileFacts,
  saveProfile,
  saveSettings,
} from "@/lib/ipc";
import { NATIVE_LANGUAGES } from "@/lib/languages";
import { languageName } from "@/lib/text";
import type { ThemeChoice } from "@/lib/theme";
import { ConnectionPanel } from "./ConnectionPanel";
import { ReadAloud } from "./ReadAloud";
import { VoiceModels } from "./VoiceModels";

interface SettingsScreenProps {
  profile: Profile;
  settings: Settings;
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
  onProfileChange: (profile: Profile) => void;
  onSettingsChange: (settings: Settings) => void;
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}): ReactNode {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-6 border-t border-line pt-10"
    >
      <h2 id={id} className="text-lg font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Everything onboarding asked, editable, plus memory and recordings. */
export function SettingsScreen({
  profile,
  settings,
  theme,
  onThemeChange,
  onProfileChange,
  onSettingsChange,
}: SettingsScreenProps): ReactNode {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState(profile.name ?? "");
  const [hasKey, setHasKey] = useState(false);
  const [facts, setFacts] = useState<Array<{ id: string; text: string }>>([]);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [audio, setAudio] = useState<"idle" | "confirm" | "deleted">("idle");

  useEffect(() => {
    let live = true;
    void Promise.all([hasApiKey(), listProfileFacts()]).then(([key, list]) => {
      if (live) {
        setHasKey(key);
        setFacts(list);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const update = async (next: Partial<Profile>): Promise<void> => {
    const merged = { ...profile, ...next };
    setFailure(null);
    try {
      await saveProfile(merged);
      onProfileChange(merged);
      setSaved(true);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  const setStrictSpelling = async (strictSpelling: boolean): Promise<void> => {
    const next = { ...settings, strictSpelling };
    setFailure(null);
    try {
      await saveSettings(next);
      onSettingsChange(next);
      setSaved(true);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  const forget = async (id: string): Promise<void> => {
    try {
      await deleteProfileFact(id);
      setFacts((held) => held.filter((fact) => fact.id !== id));
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  const removeAudio = async (): Promise<void> => {
    try {
      await deleteSessionAudio(null);
      setAudio("deleted");
    } catch (error) {
      setAudio("idle");
      setFailure(errorMessage(error));
    }
  };

  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-10 px-10 pt-16 pb-20">
        <header className="flex items-baseline justify-between gap-4">
          <h1 className="text-display font-semibold text-ink">
            {t("settings.title")}
          </h1>
          <p
            aria-live="polite"
            className="flex items-center gap-1.5 text-sm text-ink-faint"
          >
            {saved && (
              <>
                <Check aria-hidden className="size-4 text-accent-text" />
                {t("common.saved")}
              </>
            )}
          </p>
        </header>
        {failure !== null && (
          <Notice tone="danger">
            {t("common.error", { message: failure })}
          </Notice>
        )}

        <Section id="settings-profile" title={t("settings.profile")}>
          <div className="grid grid-cols-2 gap-5">
            <Field id="settings-name" label={t("settings.name")}>
              <TextInput
                id="settings-name"
                value={name}
                maxLength={60}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                onBlur={() => {
                  const trimmed = name.trim();
                  if (trimmed !== (profile.name ?? "")) {
                    void update({ name: trimmed === "" ? null : trimmed });
                  }
                }}
              />
            </Field>
            <Field id="settings-native" label={t("settings.nativeLang")}>
              <Select
                id="settings-native"
                value={profile.nativeLang}
                onChange={(event) => {
                  void update({ nativeLang: event.target.value });
                }}
              >
                {NATIVE_LANGUAGES.map((code) => (
                  <option key={code} value={code}>
                    {languageName(code, i18n.language)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="settings-goal" label={t("settings.goal")}>
              <Select
                id="settings-goal"
                value={profile.goal}
                onChange={(event) => {
                  void update({ goal: event.target.value as Goal });
                }}
              >
                {(["work", "travel", "exams", "social", "other"] as const).map(
                  (goal) => (
                    <option key={goal} value={goal}>
                      {t(`goal.${goal}`)}
                    </option>
                  ),
                )}
              </Select>
            </Field>
            <Field id="settings-level" label={t("settings.level")}>
              <Select
                id="settings-level"
                value={profile.level}
                onChange={(event) => {
                  void update({ level: event.target.value as Level });
                }}
              >
                {(["basic", "intermediate", "advanced"] as const).map(
                  (level) => (
                    <option key={level} value={level}>
                      {t(`level.${level}`)}
                    </option>
                  ),
                )}
              </Select>
            </Field>
            <Field id="settings-variant" label={t("settings.variant")}>
              <Select
                id="settings-variant"
                value={profile.variant}
                onChange={(event) => {
                  void update({ variant: event.target.value as Variant });
                }}
              >
                {(["us", "uk"] as const).map((variant) => (
                  <option key={variant} value={variant}>
                    {t(`variant.${variant}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-ink">
              {t("settings.interests")}
            </p>
            <InterestPicker
              value={profile.interests}
              onChange={(interests) => void update({ interests })}
            />
          </div>
          <ReminderPicker
            legend={t("settings.reminder")}
            value={profile.reminderTime}
            onChange={(reminderTime) => void update({ reminderTime })}
          />
        </Section>

        <Section id="settings-appearance" title={t("settings.appearance")}>
          <ChoiceGroup<ThemeChoice>
            legend={t("settings.theme")}
            columns={3}
            size="sm"
            value={theme}
            onChange={onThemeChange}
            choices={(["system", "light", "dark"] as const).map((value) => ({
              value,
              label: t(`theme.${value}`),
            }))}
          />
          <ChoiceGroup<UiLang>
            legend={t("settings.uiLang")}
            columns={3}
            size="sm"
            value={profile.uiLang}
            onChange={(uiLang) => void update({ uiLang })}
            choices={(["en", "es"] as const).map((value) => ({
              value,
              label: t(`language.${value}`),
            }))}
          />
        </Section>

        <Section id="settings-spelling" title={t("settings.spelling")}>
          <ChoiceGroup<"lenient" | "strict">
            legend={t("spelling.legend")}
            columns={2}
            size="sm"
            value={settings.strictSpelling ? "strict" : "lenient"}
            onChange={(value) => void setStrictSpelling(value === "strict")}
            choices={(["lenient", "strict"] as const).map((value) => ({
              value,
              label: t(`spelling.${value}`),
              description: t(`spelling.${value}Body`),
            }))}
          />
        </Section>

        <Section id="settings-connection" title={t("settings.connection")}>
          <ConnectionPanel
            settings={settings}
            hasKey={hasKey}
            onSettingsChange={onSettingsChange}
            onHasKeyChange={setHasKey}
          />
        </Section>

        <Section id="settings-voice" title={t("settings.voice")}>
          <VoiceModels
            onSelected={(sttModel) => {
              onSettingsChange({ ...settings, sttModel });
            }}
          />
        </Section>

        <Section id="settings-read-aloud" title={t("settings.readAloud")}>
          <ReadAloud />
        </Section>

        <Section id="settings-memory" title={t("settings.memory")}>
          <p className="text-ink-soft">{t("settings.factsBody")}</p>
          {facts.length === 0 ? (
            <p className="text-sm text-ink-faint">{t("settings.factsEmpty")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {facts.map((fact) => (
                <li
                  key={fact.id}
                  className="flex items-center justify-between gap-4 py-2.5"
                >
                  <span className="text-ink">{fact.text}</span>
                  <button
                    type="button"
                    aria-label={t("settings.forget", { fact: fact.text })}
                    onClick={() => void forget(fact.id)}
                    className="grid size-8 shrink-0 place-items-center rounded-sm text-ink-faint hover:bg-raised hover:text-ink"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="settings-data" title={t("settings.data")}>
          <p className="text-ink-soft">{t("settings.deleteAudioBody")}</p>
          <div aria-live="polite">
            {audio === "idle" && (
              <Button
                variant="danger"
                icon={<Trash2 aria-hidden className="size-4" />}
                onClick={() => {
                  setAudio("confirm");
                }}
              >
                {t("settings.deleteAudio")}
              </Button>
            )}
            {audio === "confirm" && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-ink">{t("settings.confirmDelete")}</p>
                <Button variant="danger" onClick={() => void removeAudio()}>
                  {t("settings.confirm")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAudio("idle");
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            )}
            {audio === "deleted" && (
              <p className="flex items-center gap-2 text-ink-soft">
                <Check aria-hidden className="size-4 text-accent-text" />
                {t("settings.audioDeleted")}
              </p>
            )}
          </div>
        </Section>

        <Section id="settings-about" title={t("update.about")}>
          <AppUpdate />
        </Section>
      </div>
    </main>
  );
}
