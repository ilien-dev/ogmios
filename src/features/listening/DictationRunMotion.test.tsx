import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { MotionGlobalConfig } from "motion/react";
import * as ipc from "@/lib/ipc";
import { startDictation } from "@/lib/ipc";
import { ScreenLeaving } from "@/lib/motion";
import { useMockBackend } from "@/test/mockBackend";
import { DictationRun } from "./DictationRun";

const FIELD = "Type what you hear";

/** A dictation of the mock's chapter, at its first sentence. */
async function dictation(): Promise<string> {
  return (await startDictation("book-alice-1", "normal")).id;
}

describe("a dictation under animation", () => {
  useMockBackend();

  describe("from one sentence to the next", () => {
    const nativeAnimate = Element.prototype.animate;

    // As in `motion.test.tsx`: real exits, on motion's own frame loop.
    beforeEach(() => {
      MotionGlobalConfig.skipAnimations = false;
      Reflect.deleteProperty(Element.prototype, "animate");
    });

    afterEach(() => {
      MotionGlobalConfig.skipAnimations = true;
      Element.prototype.animate = nativeAnimate;
    });

    /** The field that takes a sentence: never one on its way out. */
    function ask(): HTMLTextAreaElement {
      const fields = screen.queryAllByLabelText<HTMLTextAreaElement>(FIELD);
      const live = fields.find((each) => each.closest("[inert]") === null);
      if (live === undefined) {
        throw new Error("No field takes a sentence.");
      }
      return live;
    }

    function leaving(): Element | null {
      return document.querySelector("[inert]");
    }

    /** Everything on the screen has finished coming in. */
    function settled(): Promise<void> {
      return waitFor(() => {
        const moving = [
          ...document.querySelectorAll<HTMLElement>('[style*="opacity"]'),
        ].filter((each) => each.style.opacity !== "1");
        expect(moving).toHaveLength(0);
      });
    }

    async function running(): Promise<UserEvent> {
      render(
        <DictationRun
          sittingId={await dictation()}
          onLeave={mock()}
          onAgain={mock()}
        />,
      );
      await screen.findByLabelText(FIELD);
      await settled();
      return userEvent.setup({ delay: null });
    }

    test("Enter during an exit answers the new sentence and never the old one twice", async () => {
      const sent = spyOn(ipc, "answerDictation");
      const user = await running();

      await user.keyboard("the boy woke{Enter}");
      const onward = await screen.findByRole("button", { name: /^Next/ });
      await settled();
      await user.click(onward);
      // The next sentence is in, the last is still leaving over it.
      await waitFor(() => {
        expect(leaving() === null).toBe(false);
      });
      expect(ask()).toHaveValue("");
      expect(ask()).toHaveFocus();

      await user.keyboard("he lay still{Enter}");
      await waitFor(() => {
        expect(sent).toHaveBeenCalledTimes(2);
      });
      expect(sent.mock.calls.map((call) => call[2])).toEqual([
        "the boy woke",
        "he lay still",
      ]);
      const [first, second] = sent.mock.calls.map((call) => call[1]);
      expect(second).not.toBe(first);
      await waitFor(() => {
        expect(leaving() === null).toBe(true);
      });
      expect(sent).toHaveBeenCalledTimes(2);
    });
  });

  describe("when its screen leaves", () => {
    test("it falls silent as the exit starts and is not stopped again after", async () => {
      const stopped = spyOn(ipc, "ttsStop");
      const id = await dictation();
      const screenOf = (leave: boolean): ReactNode => (
        <ScreenLeaving.Provider value={leave}>
          <DictationRun sittingId={id} onLeave={mock()} onAgain={mock()} />
        </ScreenLeaving.Provider>
      );
      const { rerender, unmount } = render(screenOf(false));
      await screen.findByLabelText(FIELD);
      expect(stopped).toHaveBeenCalledTimes(0);

      rerender(screenOf(true));
      expect(stopped).toHaveBeenCalledTimes(1);

      // The exit ends: whatever the next screen has begun is left alone.
      unmount();
      expect(stopped).toHaveBeenCalledTimes(1);
    });
  });
});
