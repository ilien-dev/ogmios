import { describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PracticeItem, ShownSentence, WordHint } from "@shared/domain";
import { useMockBackend } from "@/test/mockBackend";
import { SittingItem } from "./SittingItem";
import type { Checked } from "./SittingItem";

const SENTENCE: ShownSentence = {
  id: "s1",
  text: "She stirred the soup.",
  translation: "Removió la sopa.",
  book: false,
};

/** "stirred", asked for in English with its sentence blanked. */
const BLANKED: PracticeItem = {
  wordId: "w1",
  direction: "production",
  prompt: "removió",
  partOfSpeech: "verb",
  context: [
    { text: "She ", marked: false },
    { text: "", marked: true },
    { text: " the soup.", marked: false },
  ],
  sentenceId: "s1",
  verbForm: "past",
};

/** The same word shown in its sentence, to be translated. */
const SHOWN: PracticeItem = {
  ...BLANKED,
  direction: "recognition",
  prompt: "stirred",
  context: [
    { text: "She ", marked: false },
    { text: "stirred", marked: true },
    { text: " the soup.", marked: false },
  ],
};

const PLAIN = { again: false, helped: false, exact: null, sentence: SENTENCE };

interface Stage {
  /** Every answer sent, with whether it was the second try. */
  sent: Array<[string, boolean]>;
  /** The steps the item went on to. */
  went: unknown[];
}

/** The item on the screen, answered by `check`. */
function stage(
  item: PracticeItem,
  check: (answer: string, second: boolean) => Checked,
  bad: (() => Promise<unknown>) | null = null,
): Stage {
  const held: Stage = { sent: [], went: [] };
  render(
    <SittingItem
      nativeLang="es"
      item={item}
      check={(answer, second) => {
        held.sent.push([answer, second]);
        return Promise.resolve(check(answer, second));
      }}
      know={null}
      dispute={null}
      notice={null}
      onDispute={null}
      bad={bad}
      onNext={(step) => {
        held.went.push(step);
      }}
    />,
  );
  return held;
}

describe("a hint on a word", () => {
  useMockBackend();

  /** "stir", asked on its own: no sentence comes with it. */
  const BARE: PracticeItem = { ...SHOWN, context: null, sentenceId: null };
  /** The first hint: the sentence the word was asked without, alone. */
  const SENTENCE_ONLY: WordHint = {
    mask: null,
    context: [
      { text: "She ", marked: false },
      { text: "stirred", marked: true },
      { text: " the soup.", marked: false },
    ],
    more: true,
  };
  const LENGTH: WordHint = { ...SENTENCE_ONLY, mask: "_______" };
  const LETTER: WordHint = { ...SENTENCE_ONLY, mask: "r______", more: false };

  /** The bare word on the screen; what was asked for and what was sent. */
  function hinted(): { asked: number[]; sent: Array<[string, boolean]> } {
    const held = {
      asked: [] as number[],
      sent: [] as Array<[string, boolean]>,
    };
    render(
      <SittingItem
        nativeLang="es"
        item={BARE}
        check={(answer, _second, withHint) => {
          held.sent.push([answer, withHint]);
          return Promise.resolve({
            ...PLAIN,
            correct: true,
            accepted: ["remover"],
            step: "next",
            helped: withHint,
            sentence: null,
          });
        }}
        hint={(asked) => {
          held.asked.push(asked);
          return Promise.resolve([SENTENCE_ONLY, LENGTH][asked] ?? LETTER);
        }}
        know={null}
        dispute={null}
        notice={null}
        onDispute={null}
        onNext={() => null}
      />,
    );
    return held;
  }

  test("gives the sentence, then the length, then one more letter, and the answer is a helped one", async () => {
    const user = userEvent.setup();
    const held = hinted();
    const field = screen.getByLabelText("Your translation");
    // The word and nothing else, until a hint is asked for.
    expect(document.querySelector("mark")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Hint" }));
    expect(
      await screen.findByText("stirred", { selector: "mark" }),
    ).toBeVisible();
    expect(document.querySelector("[data-mask]")).toBeNull();
    expect(field).toHaveFocus();

    // Alt+H from the field asks for the next one: how long the answer is.
    expect(screen.getByRole("button", { name: "Hint" })).toBeEnabled();
    await user.keyboard("{Alt>}h{/Alt}");
    expect(await screen.findByText("_______")).toBeInTheDocument();
    expect(screen.getByText("stirred", { selector: "mark" })).toBeVisible();

    // Then one more letter; then there is no more.
    await user.click(screen.getByRole("button", { name: "One more letter" }));
    expect(await screen.findByText("r______")).toBeInTheDocument();
    expect(held.asked).toEqual([0, 1, 2]);
    expect(
      screen.getByRole("button", { name: "One more letter" }),
    ).toBeDisabled();
    await user.keyboard("{Alt>}h{/Alt}");
    expect(held.asked).toEqual([0, 1, 2]);
    expect(field).toHaveValue("");

    await user.type(field, "remover{Enter}");
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    expect(held.sent).toEqual([["remover", true]]);
    // Once answered the hint is gone: the verdict says it all.
    expect(screen.queryByText("r______")).not.toBeInTheDocument();
    cleanup();
  });

  test("a verb asked on its own in another form is asked for in its base form, and its sentence stays hidden", async () => {
    const user = userEvent.setup();
    const asked: number[] = [];
    render(
      <SittingItem
        nativeLang="es"
        item={BARE}
        check={(_answer, second) =>
          Promise.resolve(
            second
              ? { ...PLAIN, correct: true, accepted: ["remover"], step: "next" }
              : {
                  ...PLAIN,
                  correct: false,
                  accepted: [],
                  step: null,
                  again: true,
                },
          )
        }
        hint={(count) => {
          asked.push(count);
          return Promise.resolve(SENTENCE_ONLY);
        }}
        know={null}
        dispute={null}
        notice={null}
        onDispute={null}
        onNext={() => null}
      />,
    );
    const field = screen.getByLabelText("Your translation");
    await user.type(field, "removido{Enter}");
    expect(
      await screen.findByText(
        "That's the word, but I'm after its base form: the infinitive. Try once more.",
      ),
    ).toBeInTheDocument();
    // The sentence has the word in another form: it would point the wrong way.
    expect(asked).toEqual([]);
    expect(document.querySelector("mark")).toBeNull();
    await user.clear(field);
    await user.type(field, "remover{Enter}");
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    cleanup();
  });

  test("a verb shown in its form and answered in another is asked for in that form", async () => {
    const user = userEvent.setup();
    render(
      <SittingItem
        nativeLang="es"
        item={{
          ...BARE,
          direction: "production",
          prompt: "jurado",
          verbForm: "pastParticiple",
        }}
        check={(_answer, second) =>
          Promise.resolve(
            second
              ? { ...PLAIN, correct: true, accepted: ["sworn"], step: "next" }
              : {
                  ...PLAIN,
                  correct: false,
                  accepted: [],
                  step: null,
                  again: true,
                },
          )
        }
        know={null}
        dispute={null}
        notice={null}
        onDispute={null}
        onNext={() => null}
      />,
    );
    expect(screen.getByText("past participle")).toBeInTheDocument();
    const field = screen.getByLabelText("Your translation");
    await user.type(field, "swear{Enter}");
    expect(
      await screen.findByText(
        "That's the word, but not in the form I'm asking for. Try once more.",
      ),
    ).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, "sworn{Enter}");
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    cleanup();
  });

  test("Alt+N from the field says the word is not known, and both keys show on their buttons", async () => {
    const user = userEvent.setup();
    const held = hinted();
    const hint = screen.getByRole("button", { name: "Hint" });
    const unknown = screen.getByRole("button", { name: "I don't know" });
    expect(hint).toHaveTextContent("Alt+H");
    expect(hint).toHaveAttribute("aria-keyshortcuts", "Alt+H");
    expect(unknown).toHaveTextContent("Alt+N");
    expect(unknown).toHaveAttribute("aria-keyshortcuts", "Alt+N");

    await user.click(screen.getByLabelText("Your translation"));
    await user.keyboard("{Alt>}n{/Alt}");
    expect(await screen.findByRole("button", { name: "Next" })).toBeVisible();
    expect(held.sent).toEqual([["", false]]);
    cleanup();
  });

  test("an answer given without one says so, and no hint is offered where none is given", async () => {
    const user = userEvent.setup();
    const held = hinted();
    await user.type(
      screen.getByLabelText("Your translation"),
      "remover{Enter}",
    );
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    expect(held.sent).toEqual([["remover", false]]);
    cleanup();

    stage(BARE, () => ({ ...PLAIN, correct: true, accepted: [], step: "x" }));
    expect(screen.queryByRole("button", { name: "Hint" })).toBeNull();
    cleanup();
  });
});

describe("a word asked with a sentence of its bank", () => {
  useMockBackend();

  test("the word in the wrong form gets one more try, in amber", async () => {
    const user = userEvent.setup();
    const held = stage(BLANKED, (answer, second) =>
      answer === "stirred"
        ? {
            ...PLAIN,
            correct: true,
            accepted: ["stirred"],
            step: "next",
            helped: second,
          }
        : {
            ...PLAIN,
            correct: false,
            accepted: [],
            step: "same",
            again: true,
            sentence: null,
          },
    );
    const field = screen.getByLabelText("Your translation");
    await user.type(field, "stir{Enter}");
    expect(
      await screen.findByText(
        "That's the word, but not the form this sentence needs. Try once more.",
      ),
    ).toBeInTheDocument();
    // No verdict yet: the field is still the learner's, and nothing went on.
    expect(field).toHaveFocus();
    expect(field).not.toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    await user.clear(field);
    await user.type(field, "stirred{Enter}");
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    expect(held.sent).toEqual([
      ["stir", false],
      ["stirred", true],
    ]);
    // The sentence whole, what it says, and where it is from.
    expect(screen.getByText("She stirred the soup.")).toBeInTheDocument();
    expect(screen.getByText("Removió la sopa.")).toBeInTheDocument();
    expect(screen.getByText("Example")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(held.went).toEqual(["next"]);
  });

  test("another word for what was shown gets one more try, with what tells them apart", async () => {
    const user = userEvent.setup();
    const asked: number[] = [];
    const sent: Array<[string, boolean, boolean]> = [];
    render(
      <SittingItem
        nativeLang="es"
        item={{ ...BLANKED, context: null }}
        check={(answer, second, withHint) => {
          sent.push([answer, second, withHint]);
          return Promise.resolve({
            ...PLAIN,
            correct: second,
            accepted: second ? ["stirred"] : [],
            step: "next",
            again: !second,
            another: second
              ? null
              : {
                  hint: {
                    mask: "s______",
                    context: BLANKED.context,
                    more: true,
                  },
                  asked: 2,
                },
            helped: second,
          });
        }}
        hint={(count) => {
          asked.push(count);
          return Promise.resolve({
            mask: "st_____",
            context: BLANKED.context,
            more: true,
          });
        }}
        know={null}
        dispute={null}
        notice={null}
        onDispute={null}
        onNext={() => null}
      />,
    );
    const field = screen.getByLabelText("Your translation");
    await user.type(field, "mixed{Enter}");
    expect(
      await screen.findByText(
        "That's right, but I'm after another word here. Try once more.",
      ),
    ).toBeInTheDocument();
    // The sentence and the first letter came with the verdict: none asked.
    expect(screen.getByText(/the soup\./)).toBeVisible();
    expect(screen.getByText("s______")).toBeVisible();
    expect(asked).toEqual([]);
    expect(field).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();

    // The hint asked for next is the one after it.
    await user.keyboard("{Alt>}h{/Alt}");
    expect(await screen.findByText("st_____")).toBeVisible();
    expect(asked).toEqual([3]);

    await user.clear(field);
    await user.type(field, "stirred{Enter}");
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    expect(sent).toEqual([
      ["mixed", false, false],
      ["stirred", true, true],
    ]);
  });

  test("the wrong form of a word asked without its sentence brings the sentence, blanked", async () => {
    const user = userEvent.setup();
    const asked: number[] = [];
    const sent: Array<[string, boolean, boolean]> = [];
    render(
      <SittingItem
        nativeLang="es"
        item={{ ...BLANKED, context: null }}
        check={(answer, second, withHint) => {
          sent.push([answer, second, withHint]);
          return Promise.resolve({
            ...PLAIN,
            correct: second,
            accepted: second ? ["stirred"] : [],
            step: "next",
            again: !second,
            helped: second,
          });
        }}
        hint={(count) => {
          asked.push(count);
          return Promise.resolve({
            mask: null,
            context: BLANKED.context,
            more: true,
          });
        }}
        know={null}
        dispute={null}
        notice={null}
        onDispute={null}
        onNext={() => null}
      />,
    );
    const field = screen.getByLabelText("Your translation");
    expect(screen.queryByText(/the soup\./)).toBeNull();
    await user.type(field, "stir{Enter}");
    // "This sentence" is on the screen for the second try.
    expect(await screen.findByText(/the soup\./)).toBeVisible();
    expect(asked).toEqual([0]);
    expect(field).toHaveFocus();

    await user.clear(field);
    await user.type(field, "stirred{Enter}");
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    expect(sent).toEqual([
      ["stir", false, false],
      ["stirred", true, true],
    ]);
    cleanup();
  });

  test("another form of the translation is right, and the form of the sentence is pointed out", async () => {
    const user = userEvent.setup();
    stage(SHOWN, () => ({
      ...PLAIN,
      correct: true,
      accepted: ["removió", "agitó"],
      step: "next",
      exact: "removió",
      sentence: { ...SENTENCE, book: true },
    }));
    await user.keyboard("removía{Enter}");
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    // Every translation shows, the ones the learner did not give too.
    expect(screen.getByText("Accepted: removió, agitó")).toBeInTheDocument();
    expect(screen.getByText("In this sentence:")).toBeInTheDocument();
    expect(document.querySelector("[data-exact]")?.textContent).toBe("removió");
    expect(screen.getByText("From the book")).toBeInTheDocument();
    // Nowhere to call it bad from: this screen does not offer it.
    expect(screen.queryByRole("button", { name: "Bad sentence" })).toBeNull();
  });

  test("the base translation of a word in another form gets one more try", async () => {
    const user = userEvent.setup();
    const held = stage({ ...SHOWN, context: null }, (_, second) =>
      second
        ? { ...PLAIN, correct: true, accepted: ["removió"], step: "next" }
        : { correct: false, accepted: [], step: null, again: true },
    );
    await user.keyboard("remover{Enter}");
    expect(
      await screen.findByText(/not the form this sentence needs/u),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Your translation"));
    await user.keyboard("removió{Enter}");
    expect(await screen.findByText(/Right/u)).toBeInTheDocument();
    expect(held.sent).toEqual([
      ["remover", false],
      ["removió", true],
    ]);
  });

  test("a miss shows the translations in the form of the sentence, and no base form", async () => {
    const user = userEvent.setup();
    stage(SHOWN, () => ({
      ...PLAIN,
      correct: false,
      accepted: ["removió", "agitó"],
      step: "next",
    }));
    await user.keyboard("mezcla{Enter}");
    expect(
      await screen.findByText("Accepted: removió, agitó"),
    ).toBeInTheDocument();
  });

  test("a verb asked in a sentence says the form it has there", () => {
    const never = (): Checked => ({ correct: false, accepted: [], step: null });
    const form = (item: PracticeItem): string | null => {
      stage(item, never);
      const text =
        document.querySelector("[data-verb-form]")?.textContent ?? null;
      cleanup();
      return text;
    };
    expect(form(SHOWN)).toBe("past simple");
    expect(form(BLANKED)).toBe("past simple");
    expect(form({ ...SHOWN, verbForm: "pastParticiple" })).toBe(
      "past participle",
    );
    // No verb, or a sentence nobody labelled yet: no tag.
    expect(form({ ...SHOWN, verbForm: null })).toBeNull();
  });

  test("the language the word is asked in stands out in its way", () => {
    const never = (): Checked => ({ correct: false, accepted: [], step: null });
    const way = (item: PracticeItem): Array<string | null> => {
      stage(item, never);
      const whole = document.querySelector("[data-way]");
      const texts = [
        whole?.querySelector("[data-from]")?.textContent ?? null,
        whole?.textContent ?? null,
      ];
      cleanup();
      return texts;
    };
    expect(way(SHOWN)).toEqual(["English", "English → Spanish"]);
    expect(way(BLANKED)).toEqual(["Spanish", "Spanish → English"]);
  });

  test("the tags of the word sit on its row, under the way it is asked", () => {
    stage(SHOWN, () => ({ correct: false, accepted: [], step: null }));
    const row = screen.getByRole("heading", { level: 1 }).parentElement;
    expect(row?.querySelector("[data-part-of-speech]")).not.toBeNull();
    expect(row?.querySelector("[data-verb-form]")).not.toBeNull();
    expect(row?.querySelector("[data-way]")).toBeNull();
    cleanup();
  });

  test("the word says what kind of word it is, whichever way it is asked", () => {
    const never = (): Checked => ({ correct: false, accepted: [], step: null });
    const tag = (item: PracticeItem): string | null => {
      stage(item, never);
      const text =
        document.querySelector("[data-part-of-speech]")?.textContent ?? null;
      cleanup();
      return text;
    };
    expect(tag(SHOWN)).toBe("verb");
    expect(tag(BLANKED)).toBe("verb");
    // A word nobody labelled, or of no kind worth naming: no tag.
    expect(tag({ ...SHOWN, partOfSpeech: null })).toBeNull();
    expect(tag({ ...SHOWN, partOfSpeech: "other" })).toBeNull();
  });

  test("a sentence called bad takes its answer back and goes on", async () => {
    const user = userEvent.setup();
    const held = stage(
      SHOWN,
      () => ({ ...PLAIN, correct: false, accepted: ["removió"], step: "next" }),
      () => Promise.resolve("another sentence"),
    );
    await user.keyboard("mezcló{Enter}");
    expect(await screen.findByText("Not quite.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Bad sentence" }));
    expect(held.went).toEqual(["another sentence"]);
  });
});
