import { afterEach, expect } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { i18n } from "@/lib/i18n/i18n";

expect.extend(matchers);

// Tests assert synchronously that things vanish. `motion.test.tsx` is the one
// file that turns this back off, to watch real exits.
MotionGlobalConfig.skipAnimations = true;

// Every test starts in English: one that switches to Spanish leaves it
// behind for whatever file runs next, and the order of files is not fixed.
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});
