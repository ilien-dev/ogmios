import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowUpCircle } from "lucide-react";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { UpdateProgress } from "./UpdateProgress";
import { useUpdate } from "./update";
import type { UpdateState, Updates } from "./update";

function body(
  state: UpdateState,
  { download, restart, later }: Updates,
  t: TFunction,
): ReactNode {
  switch (state.kind) {
    case "available":
      return (
        <>
          <p className="flex items-center gap-2 font-semibold text-ink">
            <ArrowUpCircle aria-hidden className="size-4 text-accent-text" />
            {t("update.cardTitle", { version: state.version })}
          </p>
          <p className="text-sm text-ink-soft">{t("update.cardBody")}</p>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={download}>
              {t("update.install")}
            </Button>
            <Button variant="ghost" size="sm" onClick={later}>
              {t("update.later")}
            </Button>
          </div>
        </>
      );
    case "downloading":
      return (
        <>
          <p className="font-semibold text-ink">
            {t("update.downloading", { version: state.version })}
          </p>
          <UpdateProgress progress={state.progress} />
        </>
      );
    case "ready":
      return (
        <>
          <p className="font-semibold text-ink">
            {t("update.ready", { version: state.version })}
          </p>
          <p className="text-sm text-ink-soft">{t("update.readyBody")}</p>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={restart}>
              {t("update.restart")}
            </Button>
            <Button variant="ghost" size="sm" onClick={later}>
              {t("update.later")}
            </Button>
          </div>
        </>
      );
    case "installing":
      return (
        <p className="flex items-center gap-2 text-ink-soft">
          <Spinner />
          {t("update.installing")}
        </p>
      );
    case "failed":
      return state.version === null ? null : (
        <>
          <p className="font-semibold text-danger">
            {t("update.downloadFailed")}
          </p>
          <p className="text-sm text-ink-soft">{state.message}</p>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={download}>
              {t("update.retry")}
            </Button>
            <Button variant="ghost" size="sm" onClick={later}>
              {t("update.close")}
            </Button>
          </div>
        </>
      );
    default:
      return null;
  }
}

interface UpdateCardProps {
  /** The screen has room for it; a run that takes the window does not. */
  shown?: boolean;
}

/**
 * The newer release, floating over the bottom right corner: on offer,
 * downloading, ready for the restart that installs it, or failed. Put away
 * with Later, it stays away until the row in Settings opens it again.
 */
export function UpdateCard({ shown = true }: UpdateCardProps): ReactNode {
  const { t } = useTranslation();
  const updates = useUpdate();
  const content =
    updates.folded || !shown ? null : body(updates.state, updates, t);

  return (
    <Presence>
      {content !== null && (
        <Reveal
          key="card"
          as="aside"
          aria-label={t("update.card")}
          aria-live="polite"
          className="absolute right-4 bottom-4 z-10 w-72 rounded-lg bg-surface p-4 shadow-float"
        >
          <div className="relative">
            <Presence swap>
              <Reveal
                key={updates.state.kind}
                kind="fade"
                className="flex flex-col gap-3"
              >
                {content}
              </Reveal>
            </Presence>
          </div>
        </Reveal>
      )}
    </Presence>
  );
}
