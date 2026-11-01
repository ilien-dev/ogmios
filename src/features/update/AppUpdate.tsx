import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download, RotateCw } from "lucide-react";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { UpdateProgress } from "./UpdateProgress";
import { useUpdate } from "./update";

/** How the app stands against the latest release, and what to do about it. */
export function AppUpdate(): ReactNode {
  const { t } = useTranslation();
  const { state, download, restart } = useUpdate();

  return (
    <div className="flex flex-col gap-4">
      <div
        aria-live="polite"
        className="flex flex-wrap items-center gap-3 text-ink-soft"
      >
        <Presence>
          {state.kind === "checking" && (
            <Reveal key="checking" as="p" className="flex items-center gap-2">
              <Spinner />
              {t("update.checking")}
            </Reveal>
          )}
        </Presence>
        <Presence>
          {state.kind === "installing" && (
            <Reveal key="installing" as="p" className="flex items-center gap-2">
              <Spinner />
              {t("update.installing")}
            </Reveal>
          )}
        </Presence>
        <Presence>
          {state.kind === "current" && (
            <Reveal key="current" as="p">
              {t("update.current")}
            </Reveal>
          )}
        </Presence>
        <Presence>
          {state.kind === "failed" && (
            <Reveal key="failed" as="p">
              {state.version === null
                ? t("update.failed", { message: state.message })
                : `${t("update.downloadFailed")}: ${state.message}`}
            </Reveal>
          )}
        </Presence>
        <Presence>
          {state.kind === "available" && (
            <Reveal key="available" as="p" className="text-ink">
              {t("update.available", { version: state.version })}
            </Reveal>
          )}
        </Presence>
        <Presence>
          {state.kind === "downloading" && (
            <Reveal key="downloading" className="flex w-72 flex-col gap-2">
              <p className="text-ink">
                {t("update.downloading", { version: state.version })}
              </p>
              <UpdateProgress progress={state.progress} />
            </Reveal>
          )}
        </Presence>
        <Presence>
          {state.kind === "ready" && (
            <Reveal key="ready" className="flex flex-wrap items-center gap-3">
              <p className="text-ink">
                {t("update.ready", { version: state.version })}
              </p>
              <Button
                variant="primary"
                icon={<RotateCw aria-hidden className="size-4" />}
                onClick={restart}
              >
                {t("update.restart")}
              </Button>
            </Reveal>
          )}
        </Presence>
        <Presence>
          {(state.kind === "available" ||
            (state.kind === "failed" && state.version !== null)) && (
            <Reveal key="available" as="span" kind="fade">
              <Button
                variant="primary"
                icon={<Download aria-hidden className="size-4" />}
                onClick={download}
              >
                {t(state.kind === "failed" ? "update.retry" : "update.install")}
              </Button>
            </Reveal>
          )}
        </Presence>
      </div>
    </div>
  );
}
