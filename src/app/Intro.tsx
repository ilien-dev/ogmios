import { motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FOCUS_PATH, Logo, SPIRAL_PATH } from "@/components/ui/Logo";
import { Spinner } from "@/components/ui/Spinner";
import { EASE_OUT, animated } from "@/lib/motion";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** From the first frame until the mark has landed and the name is written. */
const ARRIVE_MS = 2400;
/** The mark turning away, before the app comes in. */
const LEAVE_MS = 480;
/** How many copies of the mark stand behind it, and how far apart. */
const DEPTH = 14;
const STEP = 2.4;

const LAND: [number, number, number, number] = [0.16, 0.8, 0.3, 1];
const AWAY: [number, number, number, number] = [0.6, 0, 0.9, 0.4];

const NAME = ["o", "g", "m", "i", "o", "s"].map((letter, at) => ({
  letter,
  at,
}));
const LAYERS = Array.from({ length: DEPTH }, (_, at) => ({
  at,
  z: -(DEPTH - at) * STEP,
}));

/** Only with motion on: under reduced motion the app opens as it always did. */
export function playsIntro(): boolean {
  if (!animated()) {
    return false;
  }
  return !(
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia(REDUCED_QUERY).matches
  );
}

/** The plain loading screen: a still mark, for when the intro does not play. */
export function Loading(): ReactNode {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-6"
      aria-busy
    >
      <div className="animate-float">
        <Logo className="size-12" />
      </div>
      <p className="flex items-center gap-3 text-sm text-ink-faint">
        <Spinner />
        {t("app.loading")}
      </p>
    </div>
  );
}

interface IntroProps {
  /** Whether the app has what it needs to open. */
  ready: boolean;
  /** Called once, when the mark has turned away. */
  onDone: () => void;
}

/**
 * What the app opens with: the mark, raised in depth, flies in from far away
 * over a floor, lands flat and catches a glint while the name is written
 * under it. Once it has landed and the app is ready, it turns away. A key or
 * a click cuts the arrival short; the app is never kept waiting for it.
 */
export function Intro({ ready, onDone }: IntroProps): ReactNode {
  const { t } = useTranslation();
  const clip = `intro-${useId().replaceAll(/[^\w-]/g, "")}`;
  const [arrived, setArrived] = useState(false);
  const leaving = arrived && ready;
  const done = useRef(onDone);

  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const arrive = (): void => {
      setArrived(true);
    };
    const timer = setTimeout(arrive, ARRIVE_MS);
    window.addEventListener("keydown", arrive);
    window.addEventListener("pointerdown", arrive);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", arrive);
      window.removeEventListener("pointerdown", arrive);
    };
  }, []);

  useEffect(() => {
    if (!leaving) {
      return;
    }
    const timer = setTimeout(() => {
      done.current();
    }, LEAVE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [leaving]);

  const away = { duration: LEAVE_MS / 1000, ease: AWAY };

  return (
    <div
      className="relative flex h-full flex-col items-center justify-center gap-10 overflow-hidden"
      aria-busy={!ready}
    >
      <motion.div
        aria-hidden
        className="intro-floor"
        initial={{ opacity: 0, backgroundPositionY: "0px" }}
        animate={{
          opacity: leaving ? 0 : 0.7,
          backgroundPositionY: leaving ? "160px" : "128px",
        }}
        transition={leaving ? away : { duration: ARRIVE_MS / 1000 }}
      />

      <motion.div
        aria-hidden
        className="relative perspective-distant"
        initial={{ opacity: 0 }}
        animate={{ opacity: leaving ? 0 : 1 }}
        transition={leaving ? away : { duration: 0.4 }}
      >
        <motion.div
          className="relative size-60 transform-3d"
          initial={{ z: -1100, rotateX: 64, rotateY: -220 }}
          animate={
            leaving
              ? { z: 260, rotateX: 8, rotateY: 96 }
              : {
                  z: [-1100, 0, 0],
                  rotateX: [64, -8, 0],
                  rotateY: [-220, 10, 0],
                }
          }
          transition={
            leaving
              ? away
              : {
                  duration: 1.9,
                  times: [0, 0.84, 1],
                  ease: [LAND, "easeInOut"],
                }
          }
        >
          {LAYERS.map((layer) => (
            <motion.svg
              key={layer.at}
              viewBox="0 0 256 256"
              className="absolute inset-0 size-full"
              style={{ z: layer.z }}
            >
              <path className="fill-logo-side" d={SPIRAL_PATH} />
              <path className="fill-logo-side-accent" d={FOCUS_PATH} />
            </motion.svg>
          ))}
          <svg viewBox="0 0 256 256" className="absolute inset-0 size-full">
            <defs>
              <clipPath id={clip}>
                <path d={SPIRAL_PATH} />
              </clipPath>
            </defs>
            <path className="fill-logo-first" d={SPIRAL_PATH} />
            <path className="fill-logo-second" d={FOCUS_PATH} />
            <g clipPath={`url(#${clip})`}>
              <motion.rect
                className="fill-logo-second"
                y={-40}
                width={16}
                height={340}
                initial={{ x: -120, skewX: -22, opacity: 0.45 }}
                animate={{ x: 420 }}
                transition={{ delay: 1.8, duration: 0.6, ease: "easeInOut" }}
              />
            </g>
          </svg>
        </motion.div>
      </motion.div>

      <div className="flex flex-col items-center gap-4">
        <p className="flex font-display text-6xl font-bold tracking-tighter lowercase perspective-normal">
          <span className="sr-only">Ogmios</span>
          {NAME.map(({ letter, at }) => (
            <motion.span
              key={at}
              aria-hidden
              className="inline-block origin-bottom"
              initial={{ opacity: 0, rotateX: -95, y: 16 }}
              animate={
                leaving
                  ? { opacity: 0, y: -10 }
                  : { opacity: 1, rotateX: 0, y: 0 }
              }
              transition={
                leaving
                  ? { duration: 0.25, ease: EASE_OUT }
                  : { duration: 0.5, delay: 1.4 + at * 0.05, ease: EASE_OUT }
              }
            >
              {letter}
            </motion.span>
          ))}
        </p>
        <motion.p
          className="flex items-center gap-3 text-sm text-ink-faint"
          initial={{ opacity: 0 }}
          animate={{ opacity: arrived && !ready ? 1 : 0 }}
        >
          <Spinner />
          {t("app.loading")}
        </motion.p>
      </div>
    </div>
  );
}
