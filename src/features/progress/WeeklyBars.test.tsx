import { describe, expect, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import { useMockBackend } from "@/test/mockBackend";
import { WeeklyBars } from "./WeeklyBars";

describe("WeeklyBars", () => {
  useMockBackend();

  const WEEKS = [
    { week: "2026-10-12", minutes: 30 },
    { week: "2026-10-19", minutes: 15 },
    { week: "2026-10-26", minutes: 0.5 },
  ];

  test("the numbers stay in a table for screen readers", () => {
    render(<WeeklyBars weeks={WEEKS} />);

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.lastElementChild?.textContent)).toEqual([
      "30 min",
      "15 min",
      "30 s",
    ]);
  });

  test("the bars grow from their foot and keep their height in the style", () => {
    const { container } = render(<WeeklyBars weeks={WEEKS} />);

    const bars = [...container.querySelectorAll<HTMLElement>(".origin-bottom")];
    expect(bars.map((bar) => bar.style.height)).toEqual([
      "80%",
      "40%",
      `${(0.5 / 30) * 80}%`,
    ]);
    for (const bar of bars) {
      expect(bar).not.toHaveClass("transition-[height]");
    }
  });
});
