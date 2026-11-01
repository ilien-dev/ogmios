import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { MotionGlobalConfig } from "motion/react";
import { THEME_FADE_MS, fadeTheme } from "./theme";

const root = document.documentElement;

afterEach(() => {
  MotionGlobalConfig.skipAnimations = true;
  delete root.dataset.themeFading;
  mock.restore();
});

function reduced(matches: boolean): void {
  spyOn(globalThis, "matchMedia").mockReturnValue({
    matches,
  } as MediaQueryList);
}

test("the colours cross for the time of the token, then the page is left as it was", async () => {
  MotionGlobalConfig.skipAnimations = false;
  reduced(false);
  fadeTheme();
  expect(root.dataset.themeFading).toBeDefined();
  await Bun.sleep(THEME_FADE_MS + 60);
  expect(root.dataset.themeFading).toBeUndefined();
});

test("under reduced motion the colours change at once and nothing is put up", () => {
  MotionGlobalConfig.skipAnimations = false;
  reduced(true);
  fadeTheme();
  expect(root.dataset.themeFading).toBeUndefined();
});

test("the fade is the token's duration, and only where motion is allowed", async () => {
  const css = await Bun.file("src/styles/global.css").text();
  expect(css).toContain(`--duration-theme: ${THEME_FADE_MS}ms;`);
  const rule = css.slice(css.indexOf(":root[data-theme-fading] *,"));
  expect(rule).toContain("transition-duration: var(--duration-theme);");
  expect(css).toMatch(
    /@media \(prefers-reduced-motion: no-preference\) \{\s+:root\[data-theme-fading\]/u,
  );
});
