import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { useMockBackend } from "@/test/mockBackend";
import { SentenceStock } from "./SentenceStock";

describe("SentenceStock", () => {
  useMockBackend();

  test("says how many words have sentences, and how many sentences", () => {
    render(
      <SentenceStock
        readying
        writing={{
          chapterId: "c",
          done: 1,
          total: 2,
          words: 20,
          ready: 12,
          sentences: 58,
        }}
      />,
    );
    expect(
      screen.getByText("Sentences ready: 12 of 20 words · 58 sentences"),
    ).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", {
      name: "Words with a sentence",
    });
    // 12 of 20 words: three fifths of the way.
    expect(bar.getAttribute("aria-valuenow")).toBe("60");
  });

  test("before the preparation says, it says it is preparing them", () => {
    render(<SentenceStock readying writing={null} />);
    expect(
      screen.getByText("Preparing your words' sentences…"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  test("once they are ready it says nothing", () => {
    render(<SentenceStock readying={false} writing={null} />);
    expect(screen.queryByText(/sentences/)).toBeNull();
  });
});
