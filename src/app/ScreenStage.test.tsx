import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import {
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import type { ReactNode } from "react";
import type { Route } from "./routes";
import { ScreenStage } from "./ScreenStage";

const nativeAnimate = Element.prototype.animate;

// As in `motion.test.tsx`: real exits, on motion's own frame loop.
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

function Stage({ route, label }: { route: Route; label: string }): ReactNode {
  return (
    <ScreenStage route={route}>
      <button type="button">{label}</button>
    </ScreenStage>
  );
}

function inert(label: string): boolean {
  return screen.getByText(label).closest("[inert]") !== null;
}

test("the screen on its way out cannot be used", async () => {
  const { rerender } = render(<Stage route={{ name: "home" }} label="Old" />);
  expect(inert("Old")).toBe(false);

  rerender(<Stage route={{ name: "progress" }} label="New" />);

  expect(inert("Old")).toBe(true);
  expect(inert("New")).toBe(false);
  await waitForElementToBeRemoved(() => screen.queryByText("Old"));
});

test("two moves in a row leave only the last screen", async () => {
  const { rerender } = render(<Stage route={{ name: "home" }} label="First" />);

  rerender(<Stage route={{ name: "progress" }} label="Second" />);
  rerender(<Stage route={{ name: "settings" }} label="Third" />);

  expect(inert("First")).toBe(true);
  expect(inert("Second")).toBe(true);
  expect(inert("Third")).toBe(false);
  await waitForElementToBeRemoved(() => [
    ...screen.queryAllByText("First"),
    ...screen.queryAllByText("Second"),
  ]);
  expect(screen.getByRole("button", { name: "Third" })).toBeInTheDocument();
});

test("a change that stays on the screen keeps it in place", () => {
  const { rerender } = render(
    <Stage route={{ name: "listening" }} label="Same" />,
  );
  const held = screen.getByRole("button", { name: "Same" });

  rerender(
    <Stage route={{ name: "listening", chapterId: "c" }} label="Same" />,
  );

  expect(screen.getByRole("button", { name: "Same" })).toBe(held);
});
