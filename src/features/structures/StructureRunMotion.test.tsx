import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { MotionGlobalConfig } from "motion/react";
import * as ipc from "@/lib/ipc";
import { startStructureSitting } from "@/lib/ipc";
import { useMockBackend } from "@/test/mockBackend";
import { StructureRun } from "./StructureRun";

const FIELD = "Your sentence, in English";

describe("from one sentence to the next, with animation on", () => {
  useMockBackend();

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
    const sitting = await startStructureSitting(["can"], 10, null);
    render(
      <StructureRun sittingId={sitting.id} onLeave={mock()} onAgain={mock()} />,
    );
    await screen.findByLabelText(FIELD);
    await settled();
    return userEvent.setup({ delay: null });
  }

  test("Enter during an exit answers the new sentence and never the old one twice", async () => {
    const sent = spyOn(ipc, "answerStructure");
    const user = await running();

    await user.keyboard("first sentence{Enter}");
    const onward = await screen.findByRole("button", { name: /^Next/ });
    await settled();
    await user.click(onward);
    // The next sentence is in, the last is still leaving over it.
    await waitFor(() => {
      expect(leaving() === null).toBe(false);
    });
    expect(ask()).toHaveValue("");
    expect(ask()).toHaveFocus();

    await user.keyboard("second sentence{Enter}");
    await waitFor(() => {
      expect(sent).toHaveBeenCalledTimes(2);
    });
    expect(sent.mock.calls.map((call) => call[2])).toEqual([
      "first sentence",
      "second sentence",
    ]);
    const [first, second] = sent.mock.calls.map((call) => call[1]);
    expect(second).not.toBe(first);
    await waitFor(() => {
      expect(leaving() === null).toBe(true);
    });
    expect(sent).toHaveBeenCalledTimes(2);
  });
});
