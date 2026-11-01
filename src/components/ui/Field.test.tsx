import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import {
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import type { ReactNode } from "react";
import { Field } from "./Field";

const nativeAnimate = Element.prototype.animate;

// As in `motion.test.tsx`: real exits, driven by motion's own frame loop.
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

function Named({ error }: { error: string | null }): ReactNode {
  return (
    <Field id="name" label="Name" hint="Optional" error={error}>
      <input id="name" aria-describedby="name-hint" />
    </Field>
  );
}

test("the hint's id is held once while the error takes its place", async () => {
  const { rerender } = render(<Named error={null} />);
  expect(document.querySelectorAll("#name-hint")).toHaveLength(1);

  rerender(<Named error="Too short" />);
  // The hint is still leaving: both are on screen, and the id is not repeated.
  expect(screen.getByText("Optional")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Too short");
  expect(document.querySelectorAll("#name-hint")).toHaveLength(1);

  await waitForElementToBeRemoved(() => screen.queryByText("Optional"));
  expect(document.querySelectorAll("#name-hint")).toHaveLength(1);
  expect(document.querySelector("#name-hint")).toContainElement(
    screen.getByRole("alert"),
  );
});
