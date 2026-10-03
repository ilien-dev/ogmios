import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpCircle } from "lucide-react";
import { appVersion, checkUpdate } from "@/lib/ipc";

/**
 * The running version, checked once against the latest release at start-up.
 * A newer one turns it into a link to Settings, where it is installed.
 */
export function UpdateHint({ onOpen }: { onOpen: () => void }): ReactNode {
  const { t } = useTranslation();
  const [version, setVersion] = useState<string | null>(null);
  const [newer, setNewer] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void appVersion().then((current) => {
      if (live) {
        setVersion(current);
      }
    });
    // Offline or rate-limited: say nothing; Settings shows the reason.
    checkUpdate()
      .then((update) => {
        if (live && update !== null) {
          setNewer(update.version);
        }
      })
      .catch(() => null);
    return () => {
      live = false;
    };
  }, []);

  if (newer !== null) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-accent-text hover:bg-raised"
      >
        <ArrowUpCircle aria-hidden className="size-4" />
        {t("update.hint", { version: newer })}
      </button>
    );
  }
  return version === null ? null : (
    <p className="px-3 text-xs text-ink-faint">
      {t("update.short", { version })}
    </p>
  );
}
