import { motion } from "motion/react";
import { Crosshair, Minus, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Presence } from "@/components/motion/Presence";
import { Reveal } from "@/components/motion/Reveal";
import { cn } from "@/lib/cn";
import { TipLayer } from "./HoverTip";
import { EASE_OUT } from "@/lib/motion";

interface SceneProps {
  /** Its name, for the region. */
  label: string;
  /** What sits at its top: a thin title and its chips. */
  header?: ReactNode;
  /** The relief, which the zoom scales. */
  children: ReactNode;
  /** Glass that floats over the relief: a tooltip, a card. */
  overlay?: ReactNode;
  /** The glass panel along its bottom. */
  footer?: ReactNode;
  /** Whether it offers the zoom. */
  zoom?: boolean;
  className?: string;
}

const STEPS = [0.8, 1, 1.25, 1.5] as const;

interface RoundProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}

function Round({
  label,
  icon: Icon,
  onClick,
  disabled,
}: RoundProps): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="group flex size-11 items-center justify-center rounded-full glass text-ink transition-control hover:enabled:shadow-lift disabled:text-ink-faint"
    >
      <Icon
        aria-hidden
        className="size-4 transition-transform duration-300 ease-out-expo group-hover:scale-125"
      />
    </button>
  );
}

/**
 * The deep panel a 3D relief stands in, as in the brand proposal: a thin
 * title and chips at the top, the relief in the middle, glass floating over
 * it, and a glass panel along the bottom.
 */
export function Scene({
  label,
  header,
  children,
  overlay,
  footer,
  zoom = false,
  className,
}: SceneProps): ReactNode {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  return (
    <section
      aria-label={label}
      className={cn(
        "@container relative isolate flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-scene",
        className,
      )}
    >
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        animate={{ scale: STEPS[step] ?? 1 }}
        transition={{ duration: 0.6, ease: EASE_OUT }}
      >
        <TipLayer.Provider value={layer}>{children}</TipLayer.Provider>
      </motion.div>
      {overlay}
      <Presence>
        {header !== undefined && (
          <Reveal
            key="header"
            kind="fade"
            className="pointer-events-none relative z-10 flex flex-col gap-3.5 px-7 pt-6 *:pointer-events-auto"
          >
            {header}
          </Reveal>
        )}
      </Presence>
      <div className="pointer-events-none relative min-h-24 flex-1">
        <Presence>
          {zoom && (
            <Reveal
              key="zoom"
              kind="fade"
              className="pointer-events-auto absolute bottom-4 left-6 z-10 flex gap-2.5"
            >
              <Round
                label={t("scene.zoomIn")}
                icon={Plus}
                disabled={step === STEPS.length - 1}
                onClick={() => {
                  setStep((now) => Math.min(STEPS.length - 1, now + 1));
                }}
              />
              <Round
                label={t("scene.centre")}
                icon={Crosshair}
                onClick={() => {
                  setStep(1);
                }}
              />
              <Round
                label={t("scene.zoomOut")}
                icon={Minus}
                disabled={step === 0}
                onClick={() => {
                  setStep((now) => Math.max(0, now - 1));
                }}
              />
            </Reveal>
          )}
        </Presence>
      </div>
      <Presence>
        {footer !== undefined && (
          <Reveal
            key="footer"
            kind="fade"
            className="pointer-events-none relative z-10 px-5 pb-5 *:pointer-events-auto"
          >
            {footer}
          </Reveal>
        )}
      </Presence>
      <div
        ref={setLayer}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-30"
      />
    </section>
  );
}

/** The thin title at the top of a scene. */
export function SceneTitle({ children }: { children: ReactNode }): ReactNode {
  return (
    <h1 className="line-clamp-2 font-display text-4xl leading-tight font-light tracking-tight text-ink @3xl:text-5xl">
      {children}
    </h1>
  );
}
