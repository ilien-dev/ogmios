import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BookWord, ChapterWords } from "@shared/domain";
import { useMockBackend } from "@/test/mockBackend";
import { TriageCard } from "./TriageCard";
import { retryKey } from "./retryLine";
import { renewed } from "./TriageRun";

function word(overrides: Partial<BookWord> = {}): BookWord {
  return {
    id: "dropped",
    lemma: "dropped",
    partOfSpeech: "verb",
    verbForm: "past",
    sentence: "He dropped to his knees.",
    translations: ["cayó", "se dejó caer"],
    count: 1,
    done: false,
    strength: null,
    half: null,
    known: false,
    sorted: false,
    ...overrides,
  };
}

describe("a word's card while sorting", () => {
  useMockBackend();

  test("a verb in another form says which one, with its translations in it", () => {
    render(<TriageCard word={word()} position="1 / 2" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "dropped" }),
    ).toBeInTheDocument();
    expect(screen.getByText("cayó, se dejó caer")).toBeInTheDocument();
    expect(screen.getByText("past simple")).toBeInTheDocument();
  });

  test("a verb in its base form, or any other word, carries no form", () => {
    const { rerender } = render(
      <TriageCard word={word({ verbForm: "base" })} position="1 / 2" />,
    );
    expect(document.querySelector("[data-verb-form]")).toBeNull();

    rerender(
      <TriageCard
        word={word({ partOfSpeech: "noun", verbForm: null })}
        position="1 / 2"
      />,
    );
    expect(document.querySelector("[data-verb-form]")).toBeNull();
  });

  test("the book's sentence stays folded until it is asked for", async () => {
    const user = userEvent.setup();
    render(<TriageCard word={word()} position="1 / 2" />);
    const toggle = screen.getByRole("button", { name: "See it in the book" });
    expect(screen.queryByText("He dropped to his knees.")).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(
      await screen.findByText("He dropped to his knees."),
    ).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

describe("cards brought up to date after a labelling run", () => {
  test("each takes what it is shown as now, and keeps its marks", () => {
    const before = word({
      translations: ["caer"],
      verbForm: null,
      sorted: true,
    });
    const chapter = {} as ChapterWords["chapter"];
    const now = word({ sorted: false });

    const [card] = renewed([before], { chapter, words: [now] });

    expect(card?.translations).toEqual(["cayó", "se dejó caer"]);
    expect(card?.verbForm).toBe("past");
    expect(card?.sorted).toBe(true);
  });
});

describe("why an answer on its own is no answer yet", () => {
  test("a verb the book has in another form asks for that form, not the infinitive", () => {
    expect(retryKey(false, false, false, "past")).toBe(
      "books.sitting.askedForm",
    );
    expect(retryKey(false, false, false, "base")).toBe(
      "books.sitting.baseForm",
    );
    expect(retryKey(false, false, false)).toBe("books.sitting.baseForm");
    expect(retryKey(false, false, true, "past")).toBe(
      "books.sitting.askedForm",
    );
  });
});
