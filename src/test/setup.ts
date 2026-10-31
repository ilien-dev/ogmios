import { afterEach, expect } from "bun:test";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";

expect.extend(matchers);

// Tests assert synchronously that things vanish. `motion.test.tsx` is the one
// file that turns this back off, to watch real exits.
MotionGlobalConfig.skipAnimations = true;

afterEach(() => {
  cleanup();
});
