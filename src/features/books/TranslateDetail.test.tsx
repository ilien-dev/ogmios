import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { ReviewMark, Translation } from "@shared/domain";
import { useMockBackend } from "@/test/mockBackend";
import { Summary } from "./TranslateDetail";

const CLEAN = "Nothing to correct. Well done.";

/** A finished attempt of one paragraph, summed up with nothing to say. */
function attempt(marks: ReviewMark[]): Translation {
  return {
    attemptId: "attempt-1",
    chapterId: "chapter-1",
    direction: "toNative",
    finished: true,
    score: marks.length === 0 ? 100 : 75,
    summary: { points: [], habits: [] },
    paragraphs: [
      {
        index: 0,
        source: ["Ouch!"],
        written: ["Auch."],
        review: {
          score: marks.length === 0 ? 100 : 75,
          good: null,
          sentences: [[{ text: "Auch.", mark: null }]],
          marks,
        },
        english: ["Ouch!"],
        learned: [[{ text: "Ouch!", marked: false }]],
      },
    ],
    current: null,
    total: 1,
  };
}

describe("Summary", () => {
  useMockBackend();

  test("says there is nothing to correct only when no paragraph has a mark", () => {
    const { rerender } = render(
      <Summary translation={attempt([])} failure={null} />,
    );
    expect(screen.getByText(CLEAN)).toBeInTheDocument();

    // A summary is written from the errors: slips leave it empty, and marked.
    const slip: ReviewMark = {
      fragment: "Auch",
      severity: "slip",
      better: "Ay",
      why: "Se escribe «ay».",
      word: null,
    };
    rerender(<Summary translation={attempt([slip])} failure={null} />);
    expect(screen.queryByText(CLEAN)).toBeNull();
  });
});
