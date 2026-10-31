import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { act, render, waitFor } from "@testing-library/react";
import { MotionGlobalConfig, motionValue } from "motion/react";
import { Orb } from "./Orb";
import { orbLean } from "./useOrbPointer";

const nativeAnimate = Element.prototype.animate;

afterEach(() => {
  MotionGlobalConfig.skipAnimations = true;
  Element.prototype.animate = nativeAnimate;
  mock.restore();
});

function shell(container: HTMLElement): HTMLElement {
  return container.firstChild as HTMLElement;
}

function ball(container: HTMLElement): Element {
  return container.querySelector(".size-full") as Element;
}

function withPointer(): void {
  MotionGlobalConfig.skipAnimations = false;
  Reflect.deleteProperty(Element.prototype, "animate");
  spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
  } as MediaQueryList);
}

describe("orbLean", () => {
  test("leans towards the pointer and never past 12 px", () => {
    const { x, y } = orbLean(3000, 4000);

    expect(orbLean(5000, 0).x).toBe(12);
    expect(orbLean(-5000, 0).x).toBe(-12);
    expect(Math.hypot(x, y)).toBeCloseTo(12);
    expect(orbLean(240, 0).x).toBe(6);
  });

  test("is brighter the closer the pointer is", () => {
    expect(orbLean(0, 0).near).toBe(1);
    expect(orbLean(240, 0).near).toBe(0.5);
    expect(orbLean(5000, 0).near).toBe(0);
  });
});

describe("Orb", () => {
  test("is hidden from a screen reader and sized by name", () => {
    const { container } = render(<Orb size="xl" />);

    expect(shell(container)).toHaveAttribute("aria-hidden", "true");
    expect(shell(container)).toHaveClass("size-50", "shadow-glow");
  });

  test("only the large ones glow", () => {
    const { container } = render(<Orb size="md" />);

    expect(shell(container)).not.toHaveClass("shadow-glow");
  });

  test("the book's is the warm one, with a warm glow", () => {
    const { container } = render(<Orb size="lg" section="book" />);

    expect(shell(container)).toHaveClass("shadow-glow-book");
    expect(ball(container)).toHaveClass("bg-orb-book");
  });

  test("drifts, spins while thinking and pulses while listening", () => {
    const { container, rerender } = render(<Orb size="sm" />);
    expect(ball(container)).toHaveClass("animate-orb-drift");

    rerender(<Orb size="sm" state="thinking" />);
    expect(ball(container)).toHaveClass("animate-orb-spin");

    rerender(<Orb size="sm" state="listening" />);
    expect(ball(container)).toHaveClass("animate-orb-pulse");
  });

  test("with the microphone's level it beats with it, not with its own pulse", () => {
    const { container } = render(
      <Orb size="sm" state="listening" level={motionValue(1)} />,
    );

    expect(ball(container)).not.toHaveClass("animate-orb-pulse");
    expect(shell(container).style.transform).toContain("scale(1.12)");
  });

  test("leans towards the pointer when it follows", async () => {
    withPointer();
    const { container } = render(<Orb size="sm" follow />);

    act(() => {
      globalThis.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 5000, clientY: 0 }),
      );
    });

    await waitFor(() => {
      expect(shell(container).style.transform).toContain("translateX");
    });
  });

  test("stays still when it does not follow", () => {
    withPointer();
    const { container } = render(<Orb size="sm" />);

    globalThis.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 5000, clientY: 0 }),
    );

    expect(shell(container).style.transform).toBe("none");
  });
});
