import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download, RefreshCw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { UpdateProgress } from "./UpdateProgress";
import { useUpdate } from "./update";

/** The running version, and the newer release when there is one. */
export function AppUpdate(): ReactNode {
  const { t } = useTranslation();
  const { version, state, check, download, restart } = useUpdate();

  return (
    <div className="flex flex-col gap-4">
      {version !== null && (
        <p className="font-medium text-ink">
          {t("update.version", { version })}
        </p>
      )}
      <div
        aria-live="polite"
        className="flex flex-wrap items-center gap-3 text-ink-soft"
      >
        {state.kind === "checking" && (
          <p className="flex items-center gap-2">
            <Spinner />
            {t("update.checking")}
          </p>
        )}
        {state.kind === "installing" && (
          <p className="flex items-center gap-2">
            <Spinner />
            {t("update.installing")}
          </p>
        )}
        {state.kind === "current" && <p>{t("update.current")}</p>}
        {state.kind === "failed" && (
          <p>
            {state.version === null
              ? t("update.failed", { message: state.message })
              : `${t("update.downloadFailed")}: ${state.message}`}
          </p>
        )}
        {state.kind === "available" && (
          <p className="text-ink">
            {t("update.available", { version: state.version })}
          </p>
        )}
        {state.kind === "downloading" && (
          <div className="flex w-72 flex-col gap-2">
            <p className="text-ink">
              {t("update.downloading", { version: state.version })}
            </p>
            <UpdateProgress progress={state.progress} />
          </div>
        )}
        {state.kind === "ready" && (
          <>
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
          </>
        )}
        {(state.kind === "available" ||
          (state.kind === "failed" && state.version !== null)) && (
          <Button
            variant="primary"
            icon={<Download aria-hidden className="size-4" />}
            onClick={download}
          >
            {t(state.kind === "failed" ? "update.retry" : "update.install")}
          </Button>
        )}
        {(state.kind === "current" ||
          (state.kind === "failed" && state.version === null)) && (
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw aria-hidden className="size-4" />}
            onClick={check}
          >
            {t("update.check")}
          </Button>
        )}
      </div>
    </div>
  );
}
