import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BookWord, PartOfSpeech } from "@shared/domain";
import { useMockBackend } from "@/test/mockBackend";
import { WordList } from "./WordList";

function word(lemma: string, partOfSpeech: PartOfSpeech | null): BookWord {
  return {
    id: lemma,
    lemma,
    partOfSpeech,
    translations: [`${lemma}-es`],
    count: 1,
    done: false,
    strength: null,
    half: null,
    known: false,
    sorted: false,
  };
}

/** What the word's own cell says: its base form, then its tag if it has one. */
function cell(lemma: string): string | null {
  return screen.getByRole("rowheader", { name: new RegExp(`^${lemma}`, "u") })
    .textContent;
}

describe("WordList", () => {
  useMockBackend();

  test("a word says what kind of word it is, when that is known and it is one", async () => {
    const marked: string[] = [];
    render(
      <WordList
        words={[
          word("quickly", "adverb"),
          word("give up", "phrasalVerb"),
          word("old", null),
          word("whereas", "other"),
        ]}
        onKnown={(known) => {
          marked.push(known.lemma);
        }}
      />,
    );

    expect(cell("quickly")).toBe("quicklyadverb");
    expect(cell("give up")).toBe("give upphrasal verb");
    // Prepared before words were labelled: nothing to say.
    expect(cell("old")).toBe("old");
    expect(cell("whereas")).toBe("whereas");

    // The tag is no part of the word's name: it is still marked by its own.
    await userEvent.click(
      screen.getByRole("button", { name: "I know this: quickly" }),
    );
    expect(marked).toEqual(["quickly"]);
  });

  test("a learned word shows how strong it is in the daily recall", () => {
    const marked: string[] = [];
    render(
      <WordList
        words={[
          { ...word("peep", null), done: true, strength: "settling" },
          { ...word("bank", null), done: true },
          word("hedge", null),
        ]}
        onKnown={(known) => {
          marked.push(known.lemma);
        }}
      />,
    );
    // Beside its check; a word not learned yet has none.
    expect(screen.getAllByRole("img", { name: "Done" })).toHaveLength(2);
    expect(screen.getAllByRole("img", { name: "Settling" })).toHaveLength(1);
    expect(marked).toEqual([]);
  });
});
