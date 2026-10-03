import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { errorMessage } from "@/lib/errors";
import { appVersion, checkUpdate, installUpdate } from "@/lib/ipc";

type State =
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; version: string }
  | { kind: "installing" }
  | { kind: "failed"; message: string };

/** The running version, and the newer release when there is one. */
export function AppUpdate(): ReactNode {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "checking" });

  const check = useCallback(async (): Promise<void> => {
    setState({ kind: "checking" });
    try {
      const update = await checkUpdate();
      setState(
        update === null
          ? { kind: "current" }
          : { kind: "available", version: update.version },
      );
    } catch (error) {
      setState({ kind: "failed", message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    void appVersion().then(setVersion);
    void check();
  }, [check]);

  const install = async (): Promise<void> => {
    setState({ kind: "installing" });
    try {
      await installUpdate();
      setState({ kind: "current" });
    } catch (error) {
      setState({ kind: "failed", message: errorMessage(error) });
    }
  };

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
          <p>{t("update.failed", { message: state.message })}</p>
        )}
        {state.kind === "available" && (
          <>
            <p className="text-ink">
              {t("update.available", { version: state.version })}
            </p>
            <Button
              variant="primary"
              icon={<Download aria-hidden className="size-4" />}
              onClick={() => void install()}
            >
              {t("update.install")}
            </Button>
          </>
        )}
        {(state.kind === "current" || state.kind === "failed") && (
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw aria-hidden className="size-4" />}
            onClick={() => void check()}
          >
            {t("update.check")}
          </Button>
        )}
      </div>
    </div>
  );
}
