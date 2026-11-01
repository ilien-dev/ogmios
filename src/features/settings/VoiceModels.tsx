import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Download } from "lucide-react";
import type { SttStatus } from "@shared/domain";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Swap } from "@/components/motion/Swap";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { onSttDownload, sttDownload, sttSelect, sttStatus } from "@/lib/ipc";
import { formatBytes } from "@/lib/text";

interface VoiceModelsProps {
  onSelected?: (modelId: string) => void;
}

/** Names what the section shows: the reason it can show no model is its own. */
function viewOf(status: SttStatus | null): string {
  if (status === null) {
    return "loading";
  }
  return status.available ? "models" : "unavailable";
}

/**
 * Speech-to-text models: size, download with progress, and which is in use.
 * Downloading never picks a model; the learner does, among those on disk.
 */
export function VoiceModels({ onSelected }: VoiceModelsProps): ReactNode {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<SttStatus | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    sttStatus()
      .then((loaded) => {
        if (live) {
          setStatus(loaded);
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setFailure(errorMessage(error));
        }
      });
    const unlisten = onSttDownload((event) => {
      setProgress((held) => ({
        ...held,
        [event.modelId]: event.total > 0 ? event.received / event.total : 0,
      }));
    });
    return () => {
      live = false;
      void unlisten.then((stop) => {
        stop();
      });
    };
  }, []);

  const download = async (modelId: string): Promise<void> => {
    setFailure(null);
    setProgress((held) => ({ ...held, [modelId]: 0 }));
    try {
      await sttDownload(modelId);
      setStatus(await sttStatus());
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setProgress((held) => {
        const { [modelId]: _done, ...rest } = held;
        return rest;
      });
    }
  };

  const select = async (modelId: string): Promise<void> => {
    try {
      await sttSelect(modelId);
      setStatus(await sttStatus());
      onSelected?.(modelId);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  const view = (): ReactNode => {
    if (status === null) {
      return (
        <Presence swap>
          {failure === null ? (
            <Reveal key="loading" as="span" kind="fade">
              <Spinner />
            </Reveal>
          ) : (
            <Notice key="failed" tone="danger">
              {failure}
            </Notice>
          )}
        </Presence>
      );
    }
    if (!status.available) {
      return <Notice>{t("voice.unavailable")}</Notice>;
    }

    return (
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {status.models.map((model) => {
            const fraction = progress[model.id];
            const inUse = status.selected === model.id;
            return (
              <li
                key={model.id}
                className={cn(
                  "flex flex-col gap-3 rounded-md border px-4 py-3.5",
                  inUse
                    ? "border-accent-strong bg-accent-soft"
                    : "border-line-strong",
                )}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{model.name}</p>
                    <p className="text-sm text-ink-soft">
                      {`${formatBytes(model.bytes, i18n.language)} · ${t("voice.languages", { list: model.languages.join(", ") })}`}
                    </p>
                  </div>
                  <Presence swap>
                    {inUse ? (
                      <Reveal
                        key="inUse"
                        as="span"
                        kind="fade"
                        className="flex items-center gap-1.5 text-sm font-medium text-accent-text"
                      >
                        <Check aria-hidden className="size-4" />
                        {t("voice.inUse")}
                      </Reveal>
                    ) : model.downloaded ? (
                      <Reveal key="downloaded" as="span" kind="fade">
                        <Button size="sm" onClick={() => void select(model.id)}>
                          {t("voice.use")}
                        </Button>
                      </Reveal>
                    ) : (
                      <Reveal key="download" as="span" kind="fade">
                        <Button
                          size="sm"
                          disabled={fraction !== undefined}
                          icon={
                            <Swap
                              id={
                                fraction === undefined ? "download" : "fetching"
                              }
                            >
                              {fraction === undefined ? (
                                <Download aria-hidden className="size-4" />
                              ) : (
                                <Spinner />
                              )}
                            </Swap>
                          }
                          onClick={() => void download(model.id)}
                        >
                          {fraction === undefined
                            ? t("voice.download", {
                                size: formatBytes(model.bytes, i18n.language),
                              })
                            : t("voice.downloading", {
                                percent: Math.round(fraction * 100),
                              })}
                        </Button>
                      </Reveal>
                    )}
                  </Presence>
                </div>
                <Presence>
                  {fraction !== undefined && (
                    <Reveal
                      key="fraction"
                      role="progressbar"
                      aria-label={t("voice.progressLabel", {
                        name: model.name,
                      })}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(fraction * 100)}
                      className="h-1.5 overflow-hidden rounded-full bg-sunken"
                    >
                      <div
                        className="h-full origin-left rounded-full bg-accent transition-transform duration-200"
                        style={{ transform: `scaleX(${fraction})` }}
                      />
                    </Reveal>
                  )}
                </Presence>
              </li>
            );
          })}
        </ul>
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
    <Swap as="div" id={viewOf(status)}>
      {view()}
    </Swap>
  );
}
