import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import { MotionConfig, MotionGlobalConfig } from "motion/react";
import type { ReactNode } from "react";
import {
  REVEAL,
  STAGGER_LIMIT,
  animated,
  staggerDelay,
} from "../../lib/motion";
import type { RevealKind } from "../../lib/motion";
import { CountUp } from "./CountUp";
import { Magnetic } from "./Magnetic";
import { Presence } from "./Presence";
import { Reveal } from "./Reveal";
import { Stagger } from "./Stagger";
import { Tilt } from "./Tilt";

const nativeAnimate = Element.prototype.animate;

// Without `animate` on the prototype, motion drives opacity on its own frame
// loop. Happy-dom's Web Animations reject `finished` when cancelled and nothing
// marks that handled, as a browser does, so each cancel fails the run.
beforeEach(() => {
  MotionGlobalConfig.skipAnimations = false;
  Reflect.deleteProperty(Element.prototype, "animate");
  // Motion tells a developer once that reduced motion is on; here it is asked for.
  spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  MotionGlobalConfig.skipAnimations = true;
  Element.prototype.animate = nativeAnimate;
  mock.restore();
});

function Toggle({ on }: { on: boolean }): ReactNode {
  return <Presence>{on && <Reveal key="note">note</Reveal>}</Presence>;
}

function Swap({ first }: { first: boolean }): ReactNode {
  return (
    <Presence swap>
      {first ? <Reveal key="old">old</Reveal> : <Reveal key="new">new</Reveal>}
    </Presence>
  );
}

function Reduced({ children }: { children: ReactNode }): ReactNode {
  return <MotionConfig reducedMotion="always">{children}</MotionConfig>;
}

// A spring lands on its exact target in about 0.9 s, close to the default 1 s.
const SPRING_LANDING = { timeout: 3000 };

function settled(element: HTMLElement, opacity: string): Promise<void> {
  return waitFor(() => {
    expect(element.style.opacity).toBe(opacity);
  });
}

function finePointer(matches: boolean): void {
  spyOn(window, "matchMedia").mockReturnValue({ matches } as MediaQueryList);
}

function pointerAt(element: HTMLElement, x: number, y: number): void {
  spyOn(element, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  } as DOMRect);
  fireEvent.pointerMove(element, { clientX: x, clientY: y });
}

test("animated follows the skip flag at each call", () => {
  expect(animated()).toBe(true);
  MotionGlobalConfig.skipAnimations = true;
  expect(animated()).toBe(false);
});

test("what leaves stays until its exit ends", async () => {
  const { rerender } = render(<Toggle on />);
  rerender(<Toggle on={false} />);
  expect(screen.getByText("note")).toBeInTheDocument();
  await waitForElementToBeRemoved(() => screen.queryByText("note"));
});

test("an element on its way out cannot be used", async () => {
  const { rerender } = render(<Toggle on />);
  expect(screen.getByText("note")).not.toHaveAttribute("inert");
  rerender(<Toggle on={false} />);
  expect(screen.getByText("note")).toHaveAttribute("inert");
  await waitForElementToBeRemoved(() => screen.queryByText("note"));
});

test("Presence swap puts the new element in at once", async () => {
  const { rerender } = render(<Swap first />);
  rerender(<Swap first={false} />);
  expect(screen.getByText("old")).toBeInTheDocument();
  expect(screen.getByText("new")).toBeInTheDocument();
  await waitForElementToBeRemoved(() => screen.queryByText("old"));
  expect(screen.getByText("new")).toBeInTheDocument();
});

test("with animations skipped, Presence renders in place", () => {
  MotionGlobalConfig.skipAnimations = true;
  const { rerender } = render(<Toggle on />);
  expect(screen.getByText("note").style.opacity).toBe("1");
  rerender(<Toggle on={false} />);
  expect(screen.queryByText("note")).not.toBeInTheDocument();
});

test("staggerDelay stops growing past the limit", () => {
  expect(staggerDelay(0)).toBe(0);
  expect(staggerDelay(STAGGER_LIMIT - 1)).toBeLessThan(
    staggerDelay(STAGGER_LIMIT),
  );
  expect(staggerDelay(STAGGER_LIMIT + 1988)).toBe(staggerDelay(STAGGER_LIMIT));
});

test("a long Stagger cascades by position and adds nothing past the limit", async () => {
  const rows = STAGGER_LIMIT + 20;
  render(
    <Stagger>
      {Array.from({ length: rows }, (_, row) => (
        <Reveal key={row}>{`row ${row}`}</Reveal>
      ))}
    </Stagger>,
  );
  const first = screen.getByText("row 0");
  const capped = screen.getByText(`row ${STAGGER_LIMIT}`);
  const last = screen.getByText(`row ${rows - 1}`);

  await settled(first, "1");
  expect(capped.style.opacity).toBe("0");

  await settled(capped, "1");
  expect(last.style.opacity).toBe("1");
});

test("under reduced motion, nothing stays hidden", async () => {
  const kinds = Object.keys(REVEAL) as RevealKind[];
  render(
    <Reduced>
      {kinds.map((kind) => (
        <Reveal key={kind} kind={kind}>
          {kind}
        </Reveal>
      ))}
    </Reduced>,
  );
  await Promise.all(kinds.map((kind) => settled(screen.getByText(kind), "1")));
  for (const kind of kinds) {
    expect(["", "none"]).toContain(screen.getByText(kind).style.transform);
  }
});

test("under reduced motion, an exit fades without moving", async () => {
  const { rerender } = render(
    <Reduced>
      <Toggle on />
    </Reduced>,
  );
  const note = screen.getByText("note");
  await settled(note, "1");
  rerender(
    <Reduced>
      <Toggle on={false} />
    </Reduced>,
  );
  await waitFor(() => {
    expect(Number(note.style.opacity)).toBeLessThan(1);
  });
  expect(["", "none"]).toContain(note.style.transform);
  await waitForElementToBeRemoved(() => screen.queryByText("note"));
});

test("CountUp shows the final value at once when skipped", () => {
  MotionGlobalConfig.skipAnimations = true;
  const { rerender } = render(<CountUp value={1} />);
  rerender(<CountUp value={42} />);
  expect(screen.getByText("42")).toBeInTheDocument();
});

test("CountUp shows the final value at once under reduced motion", () => {
  const { rerender } = render(
    <Reduced>
      <CountUp value={1} />
    </Reduced>,
  );
  rerender(
    <Reduced>
      <CountUp value={42} />
    </Reduced>,
  );
  expect(screen.getByText("42")).toBeInTheDocument();
});

test("CountUp starts on its value and counts to the next through format", async () => {
  const days = (n: number): string => `${n} days`;
  const { rerender } = render(<CountUp value={10} format={days} />);
  expect(screen.getByText("10 days")).toBeInTheDocument();
  rerender(<CountUp value={13} format={days} />);
  expect(screen.getByText("10 days")).toBeInTheDocument();
  expect(await screen.findByText("13 days")).toBeInTheDocument();
});

test("CountUp ends exactly on a value that is not whole", async () => {
  const { rerender } = render(<CountUp value={1} />);
  rerender(<CountUp value={2.5} />);
  expect(await screen.findByText("2.5")).toBeInTheDocument();
});

test("Tilt leans towards the pointer, up to 3 degrees", async () => {
  finePointer(true);
  render(<Tilt className="flex">card</Tilt>);
  const card = screen.getByText("card");
  expect(card).toHaveClass("flex");
  pointerAt(card, 100, 50);
  await waitFor(() => {
    expect(card.style.transform).toContain("rotateY(3deg)");
  }, SPRING_LANDING);
});

test("Tilt stays still on a touch screen", async () => {
  finePointer(false);
  render(<Tilt>card</Tilt>);
  const card = screen.getByText("card");
  pointerAt(card, 100, 50);
  await Bun.sleep(50);
  expect(["", "none"]).toContain(card.style.transform);
});

test("Magnetic moves towards the pointer, up to 6 px, and returns", async () => {
  finePointer(true);
  render(<Magnetic>button</Magnetic>);
  const button = screen.getByText("button");
  pointerAt(button, 100, 50);
  await waitFor(() => {
    expect(button.style.transform).toContain("translateX(6px)");
  }, SPRING_LANDING);
  fireEvent.pointerLeave(button);
  await waitFor(() => {
    expect(["", "none"]).toContain(button.style.transform);
  }, SPRING_LANDING);
});

test("Magnetic stays still under reduced motion", async () => {
  finePointer(true);
  render(
    <Reduced>
      <Magnetic>button</Magnetic>
    </Reduced>,
  );
  const button = screen.getByText("button");
  pointerAt(button, 100, 50);
  await Bun.sleep(50);
  expect(button.style.transform).not.toContain("translateX");
});
