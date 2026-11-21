import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Brain, Check, Sparkles, Trash2, X } from "lucide-react";
import type {
  Goal,
  Level,
  Profile,
  Settings,
  UiLang,
  Variant,
} from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger } from "@/components/motion/Stagger";
import { SceneTitle } from "@/components/scene/Scene";
import { StatChip, StatTile } from "@/components/scene/Stats";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import { AppUpdate } from "@/features/update/AppUpdate";
import { UpdateRow } from "@/features/update/UpdateRow";
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

/** Every section of the screen, for the jumps at its top. */
const SECTIONS = [
  ["settings-profile", "settings.profile"],
  ["settings-appearance", "settings.appearance"],
  ["settings-spelling", "settings.spelling"],
  ["settings-connection", "settings.connection"],
  ["settings-voice", "settings.voice"],
  ["settings-read-aloud", "settings.readAloud"],
  ["settings-memory", "settings.memory"],
  ["settings-data", "settings.data"],
  ["settings-about", "update.about"],
] as const;

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
    <Reveal
      as="section"
      aria-labelledby={id}
      className="flex flex-col gap-6 rounded-xl glass p-6 nav:p-8"
    >
      <h2
        id={id}
        className="scroll-mt-6 font-display text-2xl font-light tracking-tight text-ink"
      >
        {title}
      </h2>
      {children}
    </Reveal>
  );
}

/** One thing remembered, with the way to forget it. */
function FactRow({
  text,
  onForget,
}: {
  text: string;
  onForget: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <Reveal
      as="li"
      kind="fade"
      index={0}
      layout="position"
      className="flex items-center justify-between gap-4 py-2.5"
    >
      <span className="text-ink">{text}</span>
      <button
        type="button"
        aria-label={t("settings.forget", { fact: text })}
        onClick={onForget}
        className="group grid size-8 shrink-0 place-items-center rounded-full text-ink-faint transition-control hover:bg-raised hover:text-ink"
      >
        <X
          aria-hidden
          className="size-4 transition-transform duration-300 ease-out-expo group-hover:rotate-90"
        />
      </button>
    </Reveal>
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
    <main className="h-full overflow-y-auto wide:overflow-hidden">
      <div className="flex min-h-full flex-col gap-4 pt-2 pb-4 wide:h-full wide:flex-row">
        <Stagger className="flex w-full shrink-0 flex-col gap-3.5 wide:max-w-xs wide:overflow-y-auto wide:pb-2">
          <Reveal className="flex flex-wrap gap-2">
            <StatChip value={t(`level.${profile.level}`)} tone="accent">
              {t("settings.board.level")}
            </StatChip>
            <StatChip value={profile.variant.toUpperCase()}>
              {t(`variant.${profile.variant}`)}
            </StatChip>
          </Reveal>
          <Reveal className="grid grid-cols-2 gap-3">
            <StatTile
              icon={
                <Sparkles aria-hidden className="size-6 text-accent-text" />
              }
              label={t("settings.interests")}
              value={profile.interests.length}
            />
            <StatTile
              icon={<Brain aria-hidden className="size-6 text-partner" />}
              label={t("settings.board.remembered")}
              value={facts.length}
            />
          </Reveal>
          <Reveal
            as="nav"
            aria-label={t("settings.sections")}
            className="flex flex-col gap-1.5 rounded-xl glass p-2"
          >
            {SECTIONS.map(([id, title]) => (
              <a
                key={id}
                href={`#${id}`}
                className="group flex items-center justify-between rounded-full px-4 py-2 text-sm text-ink-soft no-underline transition-control hover:bg-accent-soft hover:text-ink"
              >
                {t(title)}
                <ArrowRight
                  aria-hidden
                  className="size-4 text-ink-faint opacity-0 transition duration-300 ease-out-expo group-hover:translate-x-0.5 group-hover:opacity-100"
                />
              </a>
            ))}
          </Reveal>
        </Stagger>
        <Reveal
          as="section"
          kind="fade"
          aria-label={t("settings.title")}
          className="relative isolate min-w-0 flex-1 rounded-2xl border border-line bg-scene wide:overflow-y-auto"
        >
          <Stagger className="mx-auto flex max-w-3xl flex-col gap-4 px-5 pt-6 pb-8 nav:px-7">
            <Reveal
              as="header"
              className="flex items-baseline justify-between gap-4"
            >
              <SceneTitle>{t("settings.title")}</SceneTitle>
              <p
                aria-live="polite"
                className="flex items-center gap-1.5 text-sm text-ink-faint"
              >
                <Presence>
                  {saved && (
                    <Reveal
                      key="saved"
                      as="span"
                      kind="fade"
                      className="flex items-center gap-1.5 rounded-full glass px-3.5 py-1.5"
                    >
                      <Check aria-hidden className="size-4 text-accent-text" />
                      {t("common.saved")}
                    </Reveal>
                  )}
                </Presence>
              </p>
            </Reveal>
            <Presence>
              {failure !== null && (
                <Reveal key="failure" kind="fade" index={0}>
                  <Notice tone="danger">
                    {t("common.error", { message: failure })}
                  </Notice>
                </Reveal>
              )}
            </Presence>

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
                    {(
                      ["work", "travel", "exams", "social", "other"] as const
                    ).map((goal) => (
                      <option key={goal} value={goal}>
                        {t(`goal.${goal}`)}
                      </option>
                    ))}
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
              <Segmented<ThemeChoice>
                legend={t("settings.theme")}
                value={theme}
                onChange={onThemeChange}
                choices={(["system", "light", "dark"] as const).map(
                  (value) => ({
                    value,
                    label: t(`theme.${value}`),
                  }),
                )}
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
              <Presence swap>
                {facts.length === 0 ? (
                  <Reveal key="empty" as="p" className="text-sm text-ink-faint">
                    {t("settings.factsEmpty")}
                  </Reveal>
                ) : (
                  <Reveal
                    key="facts"
                    as="ul"
                    className="flex flex-col divide-y divide-line"
                  >
                    <Presence>
                      {facts.map((fact) => (
                        <FactRow
                          key={fact.id}
                          text={fact.text}
                          onForget={() => void forget(fact.id)}
                        />
                      ))}
                    </Presence>
                  </Reveal>
                )}
              </Presence>
            </Section>

            <Section id="settings-data" title={t("settings.data")}>
              <p className="text-ink-soft">{t("settings.deleteAudioBody")}</p>
              <div aria-live="polite">
                <Presence>
                  {audio === "idle" && (
                    <Reveal key="idle" as="span" kind="fade">
                      <Button
                        variant="danger"
                        className="group"
                        icon={
                          <Trash2
                            aria-hidden
                            className="size-4 transition-transform duration-300 ease-out-expo group-hover:-rotate-12"
                          />
                        }
                        onClick={() => {
                          setAudio("confirm");
                        }}
                      >
                        {t("settings.deleteAudio")}
                      </Button>
                    </Reveal>
                  )}
                </Presence>
                <Presence>
                  {audio === "confirm" && (
                    <Reveal
                      key="confirm"
                      className="flex flex-wrap items-center gap-3"
                    >
                      <p className="text-ink">{t("settings.confirmDelete")}</p>
                      <Button
                        variant="danger"
                        onClick={() => void removeAudio()}
                      >
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
                    </Reveal>
                  )}
                </Presence>
                <Presence>
                  {audio === "deleted" && (
                    <Reveal
                      key="deleted"
                      as="p"
                      className="flex items-center gap-2 text-ink-soft"
                    >
                      <Check aria-hidden className="size-4 text-accent-text" />
                      {t("settings.audioDeleted")}
                    </Reveal>
                  )}
                </Presence>
              </div>
            </Section>

            <Section id="settings-about" title={t("update.about")}>
              <UpdateRow />
              <AppUpdate />
            </Section>
          </Stagger>
        </Reveal>
      </div>
    </main>
  );
}
