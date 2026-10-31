import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { render, screen } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import type { ReactNode } from "react";
import { TriageRun } from "@/features/books/TriageRun";
import { Composer } from "@/features/conversation/Composer";
import { useMockBackend } from "@/test/mockBackend";
import type { Route } from "./routes";
import { ScreenStage } from "./ScreenStage";

const nativeAnimate = Element.prototype.animate;
const HERE: Route = { name: "home" };
const ELSEWHERE: Route = { name: "progress" };

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

function Stage({
  route,
  children,
}: {
  route: Route;
  children: ReactNode;
}): ReactNode {
  return <ScreenStage route={route}>{children}</ScreenStage>;
}

/** The shortcut held down: it is claimed, and a repeat starts no recording. */
function claimsPushToTalk(): boolean {
  const press = new KeyboardEvent("keydown", {
    code: "Space",
    ctrlKey: true,
    repeat: true,
    cancelable: true,
  });
  globalThis.dispatchEvent(press);
  return press.defaultPrevented;
}

describe("a screen on its way out", () => {
  useMockBackend();

  test("takes no push-to-talk on a leaving conversation", () => {
    const conversation = (
      <Composer
        sessionId="s1"
        turnWordGoal={40}
        scaffolds={[]}
        voice
        disabled={false}
        onSend={mock(() => Promise.resolve(true))}
      />
    );
    const { rerender } = render(<Stage route={HERE}>{conversation}</Stage>);
    expect(claimsPushToTalk()).toBe(true);

    rerender(<Stage route={ELSEWHERE}>Next</Stage>);

    expect(screen.getByLabelText("Your answer")).toBeInTheDocument();
    expect(claimsPushToTalk()).toBe(false);
  });

  test("takes no Escape on a leaving sorting", () => {
    const onDone = mock();
    const sorting = (
      <TriageRun chapterId="c" onPractise={mock()} onDone={onDone} />
    );
    const escape = (): void => {
      globalThis.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    };
    const { rerender } = render(<Stage route={HERE}>{sorting}</Stage>);
    escape();
    expect(onDone).toHaveBeenCalledTimes(1);

    rerender(<Stage route={ELSEWHERE}>Next</Stage>);
    escape();

    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
