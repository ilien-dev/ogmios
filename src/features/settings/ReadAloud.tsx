import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Swap } from "@/components/motion/Swap";
import { ChoiceGroup } from "@/components/ui/ChoiceGroup";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { SpeakButton } from "@/features/speech/SpeakButton";
import { useSpeech } from "@/features/speech/speech";
import { errorMessage } from "@/lib/errors";
import { ttsConfigure } from "@/lib/ipc";

/** Said by "Listen" beside the voices: short, and with sounds worth hearing. */
const SAMPLE = "I thought I'd read through the whole chapter tonight.";

/** Names what shows: the choice needs the voice on disk. */
function viewOf(downloaded: boolean | null): string {
  if (downloaded === null) {
    return "loading";
  }
  return downloaded ? "voices" : "later";
}

/**
 * Who reads English aloud, once Listen has brought the voice: whether it
 * reads by itself is Listen's own switch, not a choice made here.
 */
export function ReadAloud(): ReactNode {
  const { t } = useTranslation();
  const { status, setStatus } = useSpeech();
  const [failure, setFailure] = useState<string | null>(null);

  const view = (): ReactNode => {
    if (status === null) {
      return <Spinner />;
    }
    if (!status.downloaded) {
      return <p className="text-sm text-ink-faint">{t("voice.readerLater")}</p>;
    }

    const pick = async (voice: string): Promise<void> => {
      setFailure(null);
      try {
        setStatus(await ttsConfigure(voice, status.enabled));
      } catch (error) {
        setFailure(errorMessage(error));
      }
    };

    return (
      <div className="flex flex-col gap-3">
        <ChoiceGroup<string>
          legend={t("voice.reader")}
          columns={2}
          size="sm"
          value={status.voice}
          onChange={(voice) => void pick(voice)}
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
        <Presence>
          {failure !== null && (
            <Reveal key="failure">
              <Notice tone="danger">
                {t("common.error", { message: failure })}
              </Notice>
            </Reveal>
          )}
        </Presence>
      </div>
    );
  };

  return (
    <Swap as="div" id={viewOf(status === null ? null : status.downloaded)}>
      {view()}
    </Swap>
  );
}
