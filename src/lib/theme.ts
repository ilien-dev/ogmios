import { useEffect, useState } from "react";

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
      applyTheme("system");
    };
    query.addEventListener("change", follow);
    return () => {
      query.removeEventListener("change", follow);
    };
  }, [choice]);

  const choose = (next: ThemeChoice): void => {
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
