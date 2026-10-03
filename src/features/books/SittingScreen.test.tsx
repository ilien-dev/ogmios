import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { Route } from "@/app/routes";
import { showsNav } from "@/app/routes";
import { i18n } from "@/lib/i18n/i18n";
import { seedMockLongChapter } from "@/lib/ipcMockChapters";
import { useMockBackend } from "@/test/mockBackend";
import { BooksScreen } from "./BooksScreen";

const CHAPTER = "I. Down the Rabbit-Hole";

/**
 * The mock chapter's words, most frequent first: English, what is shown for
 * it, a right answer.
 */
const WORDS: ReadonlyArray<[english: string, shown: string, right: string]> = [
  ["rabbit hole", "madriguera", "madriguera"],
  ["tumble", "caerse, rodar", "rodar"],
  ["curtsey", "hacer una reverencia, reverencia", "reverencia"],
  ["waistcoat", "chaleco", "chaleco"],
  ["give up", "rendirse, dejar", "rendirse"],
  ["marmalade", "mermelada", "mermelada"],
  ["peep", "asomarse, echar un vistazo", "asomarse"],
  ["hedge", "seto", "seto"],
  // The ones only the longer chapter has.
  ["bank", "orilla, ribera", "orilla"],
  ["daisy", "margarita", "margarita"],
  ["cupboard", "armario, alacena", "alacena"],
  ["shelf", "estante, repisa", "estante"],
];

/** The chapter that comes prepared: eight words, too few to choose a size. */
const SHORT = WORDS.slice(0, 8).map(([english]) => english);
/** The chapter with twelve words to practise, and its name. */
const LONG = "book-alice-3";
const LONG_NAME = "IV. The Rabbit Sends in a Little Bill";

/** The right answer to a prompt, whichever way the word is asked. */
const RIGHT: Record<string, string> = Object.fromEntries(
  WORDS.flatMap(([english, shown, right]) => [
    [english, right],
    [shown, english],
  ]),
);

/** The English word a prompt is about, whichever way it is asked. */
const WORD: Record<string, string> = Object.fromEntries(
  WORDS.flatMap(([english, shown]) => [
    [english, english],
    [shown, english],
  ]),
);

/** The books section on a prepared chapter, as the app holds its route. */
function Shelf({
  chapterId = "book-alice-0",
}: {
  chapterId?: string;
}): ReactNode {
  const [route, setRoute] = useState<Route>({
    name: "books",
    bookId: "book-alice",
    chapterId,
  });
  if (route.name !== "books") {
    return null;
  }
  return (
    <>
      {showsNav(route) && <nav aria-label="Sections" />}
      <BooksScreen
        nativeLang="es"
        bookId={route.bookId}
        chapterId={route.chapterId ?? null}
        practising={route.practising === true}
        navigate={setRoute}
      />
    </>
  );
}

/** Moves the focus forward until it is on the button called `name`. */
async function tabTo(user: UserEvent, name: string): Promise<void> {
  const button = await screen.findByRole("button", { name });
  for (let presses = 0; presses < 20 && document.activeElement !== button;) {
    presses += 1;
    await user.tab();
  }
  expect(button).toHaveFocus();
}

function prompt(): string {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

/** Everything the item shows: the word, its sentence, the form, the verdict. */
function itemText(): string {
  return (
    screen.getByRole("heading", { level: 1 }).closest("section")?.textContent ??
    ""
  );
}

/** Types an answer, checks it with Enter and goes on with Enter. */
async function answer(
  user: UserEvent,
  text: string,
  verdict: string,
  onward = "Next",
): Promise<void> {
  await user.keyboard(`${text}{Enter}`);
  expect(await screen.findByText(verdict)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: onward })).toHaveFocus();
  await user.keyboard("{Enter}");
}

/** Answers every question right until the summary; the prompts it showed. */
async function playOut(user: UserEvent): Promise<string[]> {
  const asked = [];
  while (
    screen.queryByRole("heading", { name: "That's it for now" }) === null
  ) {
    const shown = prompt();
    asked.push(shown);
    await answer(user, RIGHT[shown] ?? "", "Right.");
  }
  return asked;
}

/** How far the bar at the top says the sitting is, as a percentage. */
function bar(name = "Session progress"): number {
  return Number(
    screen.getByRole("progressbar", { name }).getAttribute("aria-valuenow"),
  );
}

/** The English words the prompts were about, once each, in order. */
function wordsOf(asked: readonly string[]): string[] {
  return [...new Set(asked.map((shown) => WORD[shown] ?? ""))].sort();
}

describe("SittingScreen", () => {
  useMockBackend();

  test("a sitting is played to its summary with the keyboard alone", async () => {
    const user = userEvent.setup();
    render(<Shelf />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    await tabTo(user, "Practice");
    await user.keyboard("{Enter}");

    // The sitting has the whole window, and the keyboard is in the answer.
    const field = await screen.findByLabelText("Your translation");
    expect(screen.queryByRole("navigation")).toBeNull();
    // The chapter's name can hold the word being asked: it is not shown.
    expect(screen.queryByText(CHAPTER)).toBeNull();
    expect(field).toHaveFocus();
    expect(prompt()).toBe("rabbit hole");
    expect(screen.getByText("English → Spanish")).toBeInTheDocument();
    expect(document.querySelector("mark")).toBeNull();

    // Enter on nothing checks nothing.
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Check" })).toBeDisabled();
    expect(screen.queryByText("Not quite.")).toBeNull();

    // Case, accents and a leading article do not count.
    await user.keyboard(" La Madriguéra{Enter}");
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    expect(screen.queryByText(/Accepted/u)).toBeNull();
    expect(screen.queryByRole("button", { name: "Check" })).toBeNull();
    expect(screen.queryByRole("button", { name: "I don't know" })).toBeNull();
    await user.keyboard("{Enter}");

    // A word flagged for context shows its sentence, the word marked.
    expect(prompt()).toBe("tumble");
    expect(screen.getByText("tumbled").closest("p")?.textContent).toBe(
      "Down she tumbled, after the Rabbit.",
    );
    expect(document.querySelector("mark")?.textContent).toBe("tumbled");
    expect(screen.getByLabelText("Your translation")).toHaveFocus();

    // A miss shows what is accepted.
    await user.keyboard("saltar{Enter}");
    expect(await screen.findByText("Not quite.")).toBeInTheDocument();
    expect(screen.getByText("Accepted: caerse, rodar")).toBeInTheDocument();
    expect(screen.getByLabelText("Your translation")).toHaveValue("saltar");
    await user.keyboard("{Enter}");

    const asked = ["rabbit hole", "tumble", ...(await playOut(user))];
    // The missed word comes back after five other words, ahead of the one
    // not seen yet; a word that was right waits for the others to go round.
    expect(asked.slice(0, 10)).toEqual([
      "rabbit hole",
      "tumble",
      "curtsey",
      "waistcoat",
      "give up",
      "marmalade",
      "peep",
      "tumble",
      "hedge",
      "rabbit hole",
    ]);
    // Never the same word again before five others, while six are open.
    const words = asked.map((shown) => WORD[shown] ?? "");
    for (const [at, word] of words.entries()) {
      const open = new Set(words.slice(at)).size;
      if (open > 5) {
        expect(words.slice(Math.max(0, at - 5), at)).not.toContain(word);
      }
    }
    // Every word of the chapter, two right answers in a row each way; the
    // miss only took its own answer.
    expect(wordsOf(asked)).toEqual([...SHORT].sort());
    expect(asked).toHaveLength(8 * 4 + 1);
    expect(asked.filter((shown) => shown === "tumble")).toHaveLength(3);
    expect(asked.filter((shown) => shown === "caerse, rodar")).toHaveLength(2);
    // A word is asked the other way once it is finished the first way.
    expect(asked.indexOf("madriguera")).toBeGreaterThan(
      asked.lastIndexOf("rabbit hole"),
    );

    // The session ends when its words are done, and here that is all.
    expect(screen.getByText("8 words done")).toBeInTheDocument();
    expect(
      screen.getByText("Every word of this chapter is done."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("heading", { level: 1, name: CHAPTER }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  test("the bar at the top follows the answers both ways and is full as the summary shows", async () => {
    const user = userEvent.setup();
    render(<Shelf />);
    await user.click(await screen.findByRole("button", { name: "Practice" }));
    await screen.findByLabelText("Your translation");

    // Eight words, four steps each. Announced as a percentage, shown as no
    // number at all.
    const shown = screen.getByRole("progressbar", { name: "Session progress" });
    expect(shown).toHaveAttribute("aria-valuemin", "0");
    expect(shown).toHaveAttribute("aria-valuemax", "100");
    expect(shown).toHaveTextContent("");
    expect(bar()).toBe(0);

    // A miss on a fresh word leaves it where it was.
    expect(prompt()).toBe("rabbit hole");
    await answer(user, "cueva", "Not quite.");
    expect(bar()).toBe(0);

    // A right answer is a step, and it shows as the sitting goes on: the
    // verdict alone does not move the bar.
    const steps = [];
    for (const word of ["tumble", "curtsey", "waistcoat", "give up"]) {
      expect(prompt()).toBe(word);
      await user.keyboard(`${RIGHT[word] ?? ""}{Enter}`);
      expect(await screen.findByText("Right.")).toBeInTheDocument();
      const before = bar();
      await user.keyboard("{Enter}");
      steps.push(bar());
      expect(bar()).toBeGreaterThan(before);
    }
    expect(steps).toEqual([3, 6, 9, 12]);

    // The pass comes round: every word has one right answer but the first.
    for (const word of ["marmalade", "rabbit hole", "peep", "hedge"]) {
      expect(prompt()).toBe(word);
      await answer(user, RIGHT[word] ?? "", "Right.");
    }
    expect(bar()).toBe(25);

    // A miss after one right answer takes that step back, and no more.
    expect(prompt()).toBe("tumble");
    await answer(user, "saltar", "Not quite.");
    expect(bar()).toBe(21);
    // "I don't know" is a miss too.
    expect(prompt()).toBe("curtsey");
    await user.click(screen.getByRole("button", { name: "I don't know" }));
    expect(await screen.findByText("Here it is.")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(bar()).toBe(18);

    // Leaving and coming back finds it where it was.
    await user.click(screen.getByRole("button", { name: "Leave practice" }));
    await user.click(await screen.findByRole("button", { name: "Practice" }));
    await screen.findByLabelText("Your translation");
    expect(bar()).toBe(18);

    // Right to the end: never back, and never full before the summary.
    let last = bar();
    while (
      screen.queryByRole("heading", { name: "That's it for now" }) === null
    ) {
      expect(bar()).toBeLessThan(100);
      expect(bar()).toBeGreaterThanOrEqual(last);
      last = bar();
      await answer(user, RIGHT[prompt()] ?? "", "Right.");
    }
    expect(last).toBe(96);
    expect(screen.getByText("8 words done")).toBeInTheDocument();
    expect(bar()).toBe(100);
  });

  test("a word the learner knows takes its steps out of the bar", async () => {
    const user = userEvent.setup();
    render(<Shelf />);
    await user.click(await screen.findByRole("button", { name: "Practice" }));
    await screen.findByLabelText("Your translation");
    await answer(user, "madriguera", "Right.");
    await answer(user, "rodar", "Right.");
    // Two steps of thirty-two.
    expect(bar()).toBe(6);

    // The word on the screen never answered: twenty-eight steps are left
    // to count, and the two taken are a larger share of them.
    expect(prompt()).toBe("curtsey");
    await user.click(screen.getByRole("button", { name: "I know this" }));
    await screen.findByRole("heading", { level: 1, name: "waistcoat" });
    expect(bar()).toBe(7);
  });

  test("a chapter with enough words asks for the size of the session, each with its estimate", async () => {
    seedMockLongChapter();
    const user = userEvent.setup();
    render(<Shelf chapterId={LONG} />);
    await tabTo(user, "Practice");
    await user.keyboard("{Enter}");

    // Every word is chosen already, and "Start" has the keyboard.
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "How many words this time?",
      }),
    ).toBeInTheDocument();
    // No session yet, so nothing to measure.
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    const ten = screen.getByRole("radio", {
      name: /^10 words\s*about 7 min$/u,
    });
    const all = screen.getByRole("radio", {
      name: /^All 12 words\s*about 8 min$/u,
    });
    expect(all).toBeChecked();
    expect(screen.getByRole("button", { name: "Start" })).toHaveFocus();

    // The sizes are one Shift+Tab and an arrow away; Enter starts.
    await user.tab({ shift: true });
    expect(all).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(ten).toBeChecked();
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Your translation")).toHaveFocus();
    expect(prompt()).toBe("rabbit hole");
    const asked = [];
    for (const shown of ["rabbit hole", "bank", "tumble"]) {
      expect(prompt()).toBe(shown);
      asked.push(shown);
      await answer(user, RIGHT[shown] ?? "", "Right.");
    }
    expect(prompt()).toBe("curtsey");

    // Leaving halfway goes back to the chapter and keeps the session:
    // "Practice" goes on with it, and asks for no size.
    await user.tab({ shift: true });
    expect(
      screen.getByRole("button", { name: "Leave practice" }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("heading", { level: 1, name: LONG_NAME }),
    ).toBeInTheDocument();
    await tabTo(user, "Practice");
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Your translation")).toHaveFocus();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(prompt()).toBe("curtsey");

    // It asks its ten words, the most frequent ones, and no other.
    asked.push(...(await playOut(user)));
    expect(asked).toHaveLength(10 * 4);
    expect(wordsOf(asked)).toEqual(
      [
        "rabbit hole",
        "bank",
        "tumble",
        "curtsey",
        "daisy",
        "waistcoat",
        "cupboard",
        "give up",
        "marmalade",
        "peep",
      ].sort(),
    );
    expect(screen.getByText("10 words done")).toBeInTheDocument();
    expect(screen.getByText("2 words still open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toHaveFocus();

    // "Continue" is the next session. Two words are one size: no choice.
    await user.keyboard("{Enter}");
    expect(await screen.findByLabelText("Your translation")).toHaveFocus();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(prompt()).toBe("shelf");
    expect(wordsOf(await playOut(user))).toEqual(["hedge", "shelf"]);
    expect(screen.getByText("2 words done")).toBeInTheDocument();
    expect(
      screen.getByText("Every word of this chapter is done."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });

  test("the size chosen is the size started, and the next session asks again", async () => {
    seedMockLongChapter();
    const user = userEvent.setup();
    render(<Shelf chapterId={LONG} />);
    await user.click(await screen.findByRole("button", { name: "Practice" }));
    await screen.findByRole("radio", { name: /^10 words/u });

    // Enter alone is every word: twelve of them, forty-eight answers.
    await user.keyboard("{Enter}");
    await screen.findByLabelText("Your translation");
    await user.click(screen.getByRole("button", { name: "I know this" }));
    await screen.findByRole("heading", { level: 1, name: "bank" });
    const asked = await playOut(user);
    expect(asked).toHaveLength(11 * 4);
    expect(wordsOf(asked)).toHaveLength(11);
    expect(screen.getByText("11 words done")).toBeInTheDocument();
  });

  test("a native → English item blanks the word and never shows it before the answer", async () => {
    const user = userEvent.setup();
    render(<Shelf />);
    await user.click(await screen.findByRole("button", { name: "Practice" }));
    await screen.findByLabelText("Your translation");
    // Every word goes round twice English → native first.
    for (const word of [...SHORT, ...SHORT]) {
      expect(prompt()).toBe(word);
      await answer(user, RIGHT[word] ?? "", "Right.");
    }

    // A word that was right twice in a row now comes the other way.
    expect(prompt()).toBe("madriguera");
    expect(screen.getByText("Spanish → English")).toBeInTheDocument();
    expect(itemText()).not.toMatch(/rabbit|hole/iu);
    await answer(user, "The Rabbit-Hole.", "Right.");

    // The sentence comes with a blank where the word was.
    expect(prompt()).toBe("caerse, rodar");
    const sentence = screen.getByText("the missing word").closest("p");
    expect(sentence?.textContent).toBe(
      "Down she the missing word, after the Rabbit.",
    );
    expect(sentence?.querySelectorAll("[data-blank]")).toHaveLength(1);
    expect(document.querySelector("mark")).toBeNull();
    expect(itemText()).not.toMatch(/tumbl/iu);

    // "I don't know" is one Tab away, and shows the English word.
    await user.tab();
    expect(screen.getByRole("button", { name: "I don't know" })).toHaveFocus();
    expect(itemText()).not.toMatch(/tumbl/iu);
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Here it is.")).toBeInTheDocument();
    expect(screen.queryByText("Not quite.")).toBeNull();
    expect(screen.getByText("Accepted: tumble")).toBeInTheDocument();
    expect(screen.getByLabelText("Your translation")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
    await user.keyboard("{Enter}");

    // A miss shows the English base form.
    expect(prompt()).toBe("hacer una reverencia, reverencia");
    expect(itemText()).not.toMatch(/curtsey/iu);
    await answer(user, "bow", "Not quite.");

    // The pass goes on with the other words, the same way.
    for (const shown of [
      "chaleco",
      "rendirse, dejar",
      "mermelada",
      "asomarse, echar un vistazo",
    ]) {
      expect(prompt()).toBe(shown);
      await answer(user, RIGHT[shown] ?? "", "Right.");
    }

    // Five words later the missed one is back, ahead of the last word of
    // the pass. Missing it one way did not send it back the other way, and
    // the form the book uses is right too.
    expect(prompt()).toBe("caerse, rodar");
    await answer(user, "to TUMBLED", "Right.");
    expect(prompt()).toBe("hacer una reverencia, reverencia");
  });

  test("not knowing a word English → native is a miss that shows the answer", async () => {
    const user = userEvent.setup();
    render(<Shelf />);
    await user.click(await screen.findByRole("button", { name: "Practice" }));
    await screen.findByLabelText("Your translation");

    await user.click(screen.getByRole("button", { name: "I don't know" }));
    expect(await screen.findByText("Here it is.")).toBeInTheDocument();
    expect(screen.getByText("Accepted: madriguera")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I don't know" })).toBeNull();
    await user.keyboard("{Enter}");

    // It counts as a miss: two in a row from there, and the other way stays
    // closed until then.
    const asked = [];
    while (
      screen.queryByRole("heading", { name: "That's it for now" }) === null
    ) {
      const shown = prompt();
      asked.push(shown);
      await answer(user, RIGHT[shown] ?? "", "Right.");
    }
    expect(asked.filter((shown) => shown === "rabbit hole")).toHaveLength(2);
    expect(asked.filter((shown) => shown === "madriguera")).toHaveLength(2);
    expect(asked.indexOf("madriguera")).toBeGreaterThan(
      asked.lastIndexOf("rabbit hole"),
    );
  });

  test("a word the learner knows is skipped for good, from the keyboard", async () => {
    const user = userEvent.setup();
    render(<Shelf />);
    await user.click(await screen.findByRole("button", { name: "Practice" }));
    await screen.findByLabelText("Your translation");
    expect(prompt()).toBe("rabbit hole");

    await tabTo(user, "I know this");
    await user.keyboard("{Enter}");
    // No verdict: the next word is simply there.
    await screen.findByRole("heading", { level: 1, name: "tumble" });
    expect(screen.queryByText("Right.")).toBeNull();
    expect(screen.getByLabelText("Your translation")).toHaveFocus();

    // It is not asked again, and the word list has set it aside.
    const asked: Set<string> = new Set();
    while (
      screen.queryByRole("heading", { name: "That's it for now" }) === null
    ) {
      asked.add(WORD[prompt()] ?? "");
      await answer(user, RIGHT[prompt()] ?? "", "Right.");
    }
    expect(asked.has("rabbit hole")).toBe(false);
    // It left the session: the seven others are all there was to finish.
    expect(asked.size).toBe(7);
    expect(screen.getByText("7 words done")).toBeInTheDocument();
    expect(
      screen.getByText("Every word of this chapter is done."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(
      await screen.findByText("1 word you already know"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Done" })).toHaveLength(7);
  });

  test("the sitting and its summary are in Spanish too", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("es");
    render(<Shelf />);
    await user.click(await screen.findByRole("button", { name: "Practicar" }));

    expect(await screen.findByLabelText("Tu traducción")).toHaveFocus();
    // How a language's name is cased depends on who names it.
    expect(screen.getByText(/^inglés → español$/iu)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Salir de la práctica" }),
    ).toBeInTheDocument();
    expect(bar("Progreso de la sesión")).toBe(0);
    await answer(user, "cueva", "Esta vez no.", "Siguiente");
    await user.keyboard("no sé{Enter}");
    expect(
      await screen.findByText("Se acepta: caerse, rodar"),
    ).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "No lo sé" }));
    expect(await screen.findByText("Aquí está.")).toBeInTheDocument();
    await user.keyboard("{Enter}");

    let backwards = false;
    while (
      screen.queryByRole("heading", { name: "Hasta aquí por ahora" }) === null
    ) {
      if (!backwards && screen.queryByText(/^español → inglés$/iu) !== null) {
        backwards = true;
        // The first word to be right twice in a row: the first not missed.
        expect(prompt()).toBe("chaleco");
      }
      await answer(user, RIGHT[prompt()] ?? "", "Correcto.", "Siguiente");
    }
    expect(backwards).toBe(true);
    expect(screen.getByText("8 palabras terminadas")).toBeInTheDocument();
    expect(bar("Progreso de la sesión")).toBe(100);
    expect(
      screen.getByText("Todas las palabras de este capítulo están terminadas."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Listo" })).toHaveFocus();
  });

  test("the choice of size and what follows it are in Spanish too", async () => {
    seedMockLongChapter();
    const user = userEvent.setup();
    await i18n.changeLanguage("es");
    render(<Shelf chapterId={LONG} />);
    await user.click(await screen.findByRole("button", { name: "Practicar" }));

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "¿Cuántas palabras esta vez?",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /^Las 12 palabras\s*unos 8 min$/u }),
    ).toBeChecked();
    await user.click(
      screen.getByRole("radio", { name: /^10 palabras\s*unos 7 min$/u }),
    );
    await user.click(screen.getByRole("button", { name: "Empezar" }));
    expect(await screen.findByLabelText("Tu traducción")).toHaveFocus();

    while (
      screen.queryByRole("heading", { name: "Hasta aquí por ahora" }) === null
    ) {
      await answer(user, RIGHT[prompt()] ?? "", "Correcto.", "Siguiente");
    }
    expect(screen.getByText("10 palabras terminadas")).toBeInTheDocument();
    expect(screen.getByText("2 palabras siguen abiertas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Listo" })).toBeInTheDocument();
  });
});
