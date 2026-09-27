import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CircleAlert,
  CircleCheck,
  KeyRound,
  Search,
  TriangleAlert,
} from "lucide-react";
import type { ProviderMode, Settings } from "@shared/domain";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { TextInput } from "@/components/ui/TextInput";
import { errorMessage } from "@/lib/errors";
import {
  checkProvider,
  detectClaude,
  saveSettings,
  setApiKey,
} from "@/lib/ipc";
import { MODELS } from "@/lib/languages";

interface ConnectionPanelProps {
  settings: Settings;
  hasKey: boolean;
  onSettingsChange: (settings: Settings) => void;
  onHasKeyChange: (hasKey: boolean) => void;
}

type Check =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok" }
  | { state: "failed"; message: string };

type Detect = "idle" | "running" | "missing";

/**
 * How Ogmios reaches Claude: the learner's API key (recommended, §1.2) or
 * their own Claude Code install. Used in onboarding and in Settings; every
 * change is saved as it is made.
 */
export function ConnectionPanel({
  settings,
  hasKey,
  onSettingsChange,
  onHasKeyChange,
}: ConnectionPanelProps): ReactNode {
  const { t } = useTranslation();
  const [key, setKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [detect, setDetect] = useState<Detect>("idle");
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [failure, setFailure] = useState<string | null>(null);

  const update = async (next: Settings): Promise<void> => {
    setCheck({ state: "idle" });
    try {
      await saveSettings(next);
      onSettingsChange(next);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  const submitKey = async (): Promise<void> => {
    const trimmed = key.trim();
    if (trimmed === "") {
      return;
    }
    setSavingKey(true);
    setFailure(null);
    try {
      await setApiKey(trimmed);
      setKey("");
      onHasKeyChange(true);
      setCheck({ state: "idle" });
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setSavingKey(false);
    }
  };

  const clearKey = async (): Promise<void> => {
    try {
      await setApiKey(null);
      onHasKeyChange(false);
      setCheck({ state: "idle" });
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  const findClaude = async (): Promise<void> => {
    setDetect("running");
    try {
      const path = await detectClaude();
      setDetect(path === null ? "missing" : "idle");
      if (path !== null) {
        await update({ ...settings, claudePath: path });
      }
    } catch (error) {
      setDetect("idle");
      setFailure(errorMessage(error));
    }
  };

  const runCheck = async (): Promise<void> => {
    setCheck({ state: "running" });
    try {
      const result = await checkProvider();
      setCheck(
        result.ok
          ? { state: "ok" }
          : { state: "failed", message: result.message ?? "" },
      );
    } catch (error) {
      setCheck({ state: "failed", message: errorMessage(error) });
    }
  };

  const ready =
    settings.providerMode === "apiKey" ? hasKey : settings.claudePath !== null;

  return (
    <div className="flex flex-col gap-6">
      <ChoiceGroup<ProviderMode>
        legend={t("settings.providerMode")}
        hideLegend
        value={settings.providerMode}
        onChange={(providerMode) => {
          void update({ ...settings, providerMode });
        }}
        choices={[
          {
            value: "apiKey",
            label: t("connection.apiKey"),
            description: t("connection.apiKeyBody"),
            badge: t("connection.apiKeyBadge"),
          },
          {
            value: "claudeCode",
            label: t("connection.claudeCode"),
            description: t("connection.claudeCodeBody"),
          },
        ]}
      />

      {settings.providerMode === "apiKey" ? (
        hasKey ? (
          <div className="flex items-center justify-between gap-4 rounded-md border border-line bg-raised px-4 py-3">
            <p className="flex items-center gap-2 text-sm text-ink-soft">
              <KeyRound aria-hidden className="size-4 text-accent-text" />
              {t("connection.keyStored")}
            </p>
            <Button size="sm" variant="ghost" onClick={() => void clearKey()}>
              {t("connection.removeKey")}
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <Field
              id="api-key"
              label={t("connection.apiKeyField")}
              className="flex-1"
            >
              <TextInput
                id="api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("connection.apiKeyPlaceholder")}
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                }}
                onKeyDown={(event) => {
                  // The panel sits inside onboarding's form: Enter saves the
                  // key rather than moving on to the next step.
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitKey();
                  }
                }}
              />
            </Field>
            <Button
              variant="primary"
              className="h-11"
              disabled={key.trim() === "" || savingKey}
              onClick={() => void submitKey()}
            >
              {t("connection.saveKey")}
            </Button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <Notice
            icon={
              <TriangleAlert aria-hidden className="size-4 text-accent-text" />
            }
          >
            {t("connection.risk")}
          </Notice>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              icon={
                detect === "running" ? (
                  <Spinner />
                ) : (
                  <Search aria-hidden className="size-4" />
                )
              }
              disabled={detect === "running"}
              onClick={() => void findClaude()}
            >
              {detect === "running"
                ? t("connection.detecting")
                : t("connection.detect")}
            </Button>
            {settings.claudePath !== null && (
              <p className="min-w-0 truncate text-sm text-ink-soft">
                {t("connection.found", { path: settings.claudePath })}
              </p>
            )}
          </div>
          {detect === "missing" && (
            <Notice tone="danger">{t("connection.notFound")}</Notice>
          )}
        </div>
      )}

      <Field
        id="model"
        label={t("connection.model")}
        hint={t("connection.modelHint")}
      >
        <Select
          id="model"
          value={settings.model}
          onChange={(event) => {
            void update({ ...settings, model: event.target.value });
          }}
        >
          {MODELS.map((model) => (
            <option key={model.id} value={model.id}>
              {`${t(`model.${model.key}`)} — ${t(`model.${model.key}Hint`)}`}
            </option>
          ))}
        </Select>
      </Field>

      <div className="flex flex-col gap-3">
        <div>
          <Button
            disabled={!ready || check.state === "running"}
            onClick={() => void runCheck()}
            icon={check.state === "running" ? <Spinner /> : undefined}
          >
            {check.state === "running"
              ? t("connection.checking")
              : t("connection.check")}
          </Button>
        </div>
        <div aria-live="polite">
          {check.state === "ok" && (
            <p className="flex items-center gap-2 text-sm text-ink">
              <CircleCheck aria-hidden className="size-4 text-accent-text" />
              {t("connection.checkOk")}
            </p>
          )}
          {check.state === "failed" && (
            <p className="flex items-center gap-2 text-sm text-danger">
              <CircleAlert aria-hidden className="size-4" />
              {t("connection.checkFailed", { message: check.message })}
            </p>
          )}
        </div>
        {failure !== null && (
          <Notice tone="danger">
            {t("common.error", { message: failure })}
          </Notice>
        )}
      </div>
    </div>
  );
}
