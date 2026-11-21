import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import "@/lib/i18n/i18n";
import { Intro, playsIntro } from "./Intro";

const nativeAnimate = Element.prototype.animate;

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe("Intro", () => {
  test("is not played while animations are off", () => {
    expect(playsIntro()).toBe(false);
  });

  describe("with animations on", () => {
    // As in `motion.test.tsx`: motion on its own frame loop.
    beforeEach(() => {
      MotionGlobalConfig.skipAnimations = false;
      Reflect.deleteProperty(Element.prototype, "animate");
      spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      MotionGlobalConfig.skipAnimations = true;
      Element.prototype.animate = nativeAnimate;
      mock.restore();
    });

    test("is played", () => {
      expect(playsIntro()).toBe(true);
    });

    test("a key cuts it short, but it waits for the app before leaving", async () => {
      const done = mock(() => {});
      const { rerender } = render(<Intro ready={false} onDone={done} />);
      expect(screen.getByText("Opening Ogmios…")).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "Enter" });
      await pause(700);
      expect(done).not.toHaveBeenCalled();

      rerender(<Intro ready onDone={done} />);
      await waitFor(() => {
        expect(done).toHaveBeenCalledTimes(1);
      });
    });

    test("left alone, it plays through and then leaves once", async () => {
      const done = mock(() => {});
      render(<Intro ready onDone={done} />);
      await pause(1500);
      expect(done).not.toHaveBeenCalled();

      await waitFor(
        () => {
          expect(done).toHaveBeenCalledTimes(1);
        },
        { timeout: 3000 },
      );
      await pause(300);
      expect(done).toHaveBeenCalledTimes(1);
    });
  });
});
