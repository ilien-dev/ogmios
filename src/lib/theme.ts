import { useEffect, useState } from "react";
import { animated } from "./motion";

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "ogmios.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readChoice(): ThemeChoice {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

function prefersDark(): boolean {
  return (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia(DARK_QUERY).matches
  );
}

/** How long colours take to cross; the same as `--duration-theme`. */
export const THEME_FADE_MS = 300;
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
let fadeTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Lets the colours cross instead of jumping, for as long as they take. A timer
 * ends it, never an event, so nothing can leave the page in the fade; with
 * reduced motion, or no animation, the colours simply change.
 */
export function fadeTheme(): void {
  const reduced =
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia(REDUCED_QUERY).matches;
  if (!animated() || reduced) {
    return;
  }
  const root = document.documentElement;
  root.dataset.themeFading = "";
  clearTimeout(fadeTimer);
  fadeTimer = setTimeout(() => {
    delete root.dataset.themeFading;
  }, THEME_FADE_MS);
}

/** Writes the resolved theme to `<html data-theme>`, which the tokens read. */
export function applyTheme(choice: ThemeChoice): void {
  const dark = choice === "dark" || (choice === "system" && prefersDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/**
 * The theme is a per-machine display preference rather than part of the
 * learner's profile, so it lives in `localStorage` beside the window.
 */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);

  useEffect(() => {
    applyTheme(choice);
    if (choice !== "system" || typeof globalThis.matchMedia !== "function") {
      return;
    }
    const query = globalThis.matchMedia(DARK_QUERY);
    const follow = (): void => {
      fadeTheme();
      applyTheme("system");
    };
    query.addEventListener("change", follow);
    return () => {
      query.removeEventListener("change", follow);
    };
  }, [choice]);

  const choose = (next: ThemeChoice): void => {
    fadeTheme();
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Without storage the choice still applies until the window closes.
    }
    setChoice(next);
  };

  return [choice, choose];
}

export function initialTheme(): void {
  applyTheme(readChoice());
}
