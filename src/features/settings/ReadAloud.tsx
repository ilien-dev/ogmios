import type { ReactNode } from "react";
import { Swap } from "@/components/motion/Swap";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Notice } from "@/components/ui/Notice";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";
import { SpeakButton } from "@/features/speech/SpeakButton";
import { useSpeech } from "@/features/speech/speech";
import { errorMessage } from "@/lib/errors";
import { ttsConfigure } from "@/lib/ipc";
import { formatBytes } from "@/lib/text";
import { Reveal } from "@/components/motion/Reveal";
import { Presence } from "@/components/motion/Presence";

/** Said by "Listen" beside the voices: short, and with sounds worth hearing. */
const SAMPLE = "I thought I'd read through the whole chapter tonight.";

/**
 * The voice that reads English aloud: one download, then who it sounds like
 * and whether it reads by itself or only when asked.
 */
export function ReadAloud(): ReactNode {
  const { t, i18n } = useTranslation();
  const { status, setStatus, fetching: fraction, fetch } = useSpeech();
  const [failure, setFailure] = useState<string | null>(null);

  const view = (): ReactNode => {
    if (status === null) {
      return <Spinner />;
    }

    const download = async (): Promise<void> => {
      setFailure(null);
      try {
        await fetch();
      } catch (error) {
        setFailure(errorMessage(error));
      }
    };

    const configure = async (
      voice: string,
      enabled: boolean,
    ): Promise<void> => {
      setFailure(null);
      try {
        setStatus(await ttsConfigure(voice, enabled));
      } catch (error) {
        setFailure(errorMessage(error));
      }
    };

    return (
      <div className="flex flex-col gap-6">
        <p className="text-ink-soft">{t("readAloud.body")}</p>
        <Presence swap>
          {status.downloaded ? (
            <Reveal key="downloaded">
              <ChoiceGroup<"on" | "off">
                legend={t("readAloud.auto")}
                columns={2}
                size="sm"
                value={status.enabled ? "on" : "off"}
                onChange={(value) =>
                  void configure(status.voice, value === "on")
                }
                choices={[
                  { value: "on", label: t("readAloud.autoOn") },
                  { value: "off", label: t("readAloud.autoOff") },
                ]}
              />
              <div className="flex flex-col gap-3">
                <ChoiceGroup<string>
                  legend={t("readAloud.voice")}
                  columns={2}
                  size="sm"
                  value={status.voice}
                  onChange={(voice) => void configure(voice, status.enabled)}
                  choices={status.voices.map((voice) => ({
                    value: voice.id,
                    label: voice.name,
                    description: t(`variant.${voice.variant}`),
                  }))}
                />
                <p className="flex items-center gap-2 text-sm text-ink-soft">
                  <SpeakButton key={status.voice} text={SAMPLE} />
                  {SAMPLE}
                </p>
              </div>
            </Reveal>
          ) : (
            <Reveal key="no-downloaded" className="flex flex-col gap-3">
              <Button
                className="self-start"
                disabled={fraction !== null}
                icon={
                  <Swap id={fraction === null ? "download" : "fetching"}>
                    {fraction === null ? (
                      <Download aria-hidden className="size-4" />
                    ) : (
                      <Spinner />
                    )}
                  </Swap>
                }
                onClick={() => void download()}
              >
                {fraction === null
                  ? t("voice.download", {
                      size: formatBytes(status.bytes, i18n.language),
                    })
                  : t("voice.downloading", {
                      percent: Math.round(fraction * 100),
                    })}
              </Button>
              <Presence>
                {fraction !== null && (
                  <Reveal key="fraction">
                    <ProgressBar
                      label={t("readAloud.progressLabel")}
                      value={fraction}
                      total={1}
                    />
                  </Reveal>
                )}
              </Presence>
            </Reveal>
          )}
        </Presence>
        <Presence>
          {failure !== null && (
            <Notice key="failure" tone="danger">
              {t("common.error", { message: failure })}
            </Notice>
          )}
        </Presence>
      </div>
    );
  };

  return (
    <Swap as="div" id={status === null ? "loading" : "ready"}>
      {view()}
    </Swap>
  );
}
