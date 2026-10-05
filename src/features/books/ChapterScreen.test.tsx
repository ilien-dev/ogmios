import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { Route } from "@/app/routes";
import { i18n } from "@/lib/i18n/i18n";
import { setMockLatency } from "@/lib/ipcMock";
import {
  seedMockReadiness,
  seedMockUnlabelled,
  setMockChapterRefusal,
} from "@/lib/ipcMockChapters";
import { setMockWordKnown } from "@/lib/ipcMockWords";
import { useMockBackend } from "@/test/mockBackend";
import { BooksScreen } from "./BooksScreen";

const REFRESH = "Quick refresh before reading";

/** The books section with the route it is given, as the app holds it. */
function Shelf(): ReactNode {
  const [route, setRoute] = useState<Route>({
    name: "books",
    bookId: "book-alice",
  });
  if (route.name !== "books") {
    return null;
  }
  return (
    <BooksScreen
      nativeLang="es"
      bookId={route.bookId}
      chapterId={route.chapterId ?? null}
      navigate={setRoute}
    />
  );
}

async function openChapter(user: UserEvent, name: string): Promise<void> {
  render(<Shelf />);
  await user.click(await screen.findByRole("button", { name }));
  expect(screen.getByRole("heading", { level: 1, name })).toBeInTheDocument();
}

/** The word list as rows of text, without its heading row. */
function rows(): Array<string | null> {
  return within(screen.getByRole("table"))
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent);
}

describe("ChapterScreen", () => {
  useMockBackend();

  test("an unprepared chapter offers three depths, each with what it means", async () => {
    const user = userEvent.setup();
    await openChapter(user, "II. The Pool of Tears");

    expect(
      screen.getByRole("heading", {
        name: "How many words do you want to learn?",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual([
      "Most wordsEvery word you probably don't know yet at your level.",
      "Relevant wordsThe unknown words that come back or carry the chapter's meaning.",
      "Hardest wordsOnly the rare words, the ones that would stop you.",
    ]);
    expect(screen.queryByRole("table")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Alice's Adventures in Wonderland" }),
    );
    expect(
      screen.getByRole("heading", { name: "Alice's Adventures in Wonderland" }),
    ).toBeInTheDocument();
  });

  test("choosing a depth shows progress, then the word list", async () => {
    const user = userEvent.setup();
    await openChapter(user, "II. The Pool of Tears");
    setMockLatency(0.03);

    await user.click(screen.getByRole("button", { name: /Hardest words/u }));
    expect(await screen.findByText("Reading the chapter…")).toBeInTheDocument();
    expect(await screen.findByText("Part 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "1",
    );
    expect(screen.queryByRole("button", { name: /Most words/u })).toBeNull();

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("4 words to learn")).toBeInTheDocument();
    expect(rows()).toEqual([
      "waistcoatnounchaleco3",
      "marmaladenounmermelada2",
      "peepverbasomarse, echar un vistazo2",
      "hedgenounseto1",
    ]);
    expect(screen.queryByText("Reading the chapter…")).toBeNull();
    // The depths wider than the one taken stay on offer.
    expect(
      screen.getByRole("heading", { name: "Want more words?" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  test("a prepared chapter opens to its words, and a wider depth adds to them", async () => {
    const user = userEvent.setup();
    await openChapter(user, "I. Down the Rabbit-Hole");

    expect(await screen.findByText("8 words to learn")).toBeInTheDocument();
    expect(rows()[0]).toBe("rabbit holenounmadriguera6");
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual([
      "Most wordsEvery word you probably don't know yet at your level.",
    ]);

    await user.click(screen.getByRole("button", { name: /Most words/u }));
    expect(await screen.findByText("12 words to learn")).toBeInTheDocument();
    expect(rows().slice(0, 2)).toEqual([
      "rabbit holenounmadriguera6",
      "banknounorilla, ribera5",
    ]);
    expect(
      screen.queryByRole("heading", { name: "Want more words?" }),
    ).toBeNull();

    // Back in the book and in again, the words are still there.
    await user.click(
      screen.getByRole("button", { name: "Alice's Adventures in Wonderland" }),
    );
    await user.click(
      screen.getByRole("button", { name: "I. Down the Rabbit-Hole" }),
    );
    expect(await screen.findByText("12 words to learn")).toBeInTheDocument();
  });

  test("words stored without their kind get it in the background, and the list shows it", async () => {
    const user = userEvent.setup();
    seedMockUnlabelled();
    setMockLatency(0.03);
    await openChapter(user, "I. Down the Rabbit-Hole");

    expect(await screen.findByText("8 words to learn")).toBeInTheDocument();
    expect(rows()[0]).toBe("rabbit holemadriguera6");
    await waitFor(() => {
      expect(rows()[0]).toBe("rabbit holenounmadriguera6");
    });
  });

  test("a word the learner knows leaves the list, and can be taken back", async () => {
    const user = userEvent.setup();
    await openChapter(user, "I. Down the Rabbit-Hole");
    expect(await screen.findByText("8 words to learn")).toBeInTheDocument();
    expect(screen.queryByText(/already know/u)).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "I know this: tumble" }),
    );
    expect(await screen.findByText("7 words to learn")).toBeInTheDocument();
    expect(rows().slice(0, 2)).toEqual([
      "rabbit holenounmadriguera6",
      "curtseyverbhacer una reverencia, reverencia3",
    ]);
    // It stays below, folded, with the way back.
    const known = screen.getByText("1 word you already know");
    expect(known.closest("details")).not.toHaveAttribute("open");
    expect(known.closest("details")).toHaveTextContent("tumblecaerse, rodar");

    // The book's rows count it as settled: one of eight.
    await user.click(
      screen.getByRole("button", { name: "Alice's Adventures in Wonderland" }),
    );
    expect(await screen.findByText("12% ready")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "I. Down the Rabbit-Hole" }),
    );

    await user.click(await screen.findByText("1 word you already know"));
    await user.click(screen.getByRole("button", { name: "Undo: tumble" }));
    expect(await screen.findByText("8 words to learn")).toBeInTheDocument();
    expect(rows()[1]).toBe("tumbleverbcaerse, rodar4");
    expect(screen.queryByText(/already know/u)).toBeNull();
  });

  test("a chapter with every word done or known is ready to read", async () => {
    seedMockReadiness();
    const user = userEvent.setup();
    await openChapter(user, "II. The Pool of Tears");

    expect(await screen.findByText("Ready to read")).toBeInTheDocument();
    // "hedge" is known; the other three are done, and say so.
    expect(screen.queryByText(/to learn/u)).toBeNull();
    expect(screen.getAllByRole("img", { name: "Done" })).toHaveLength(3);
    expect(screen.getByText("3 learned")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.queryByRole("button", { name: /^I know this/u })).toBeNull();
    // Practice stays within reach: with nothing left, it is an extra review.
    expect(
      screen.getByRole("button", { name: "Practice" }),
    ).toBeInTheDocument();
    // Its done words can be gone over once more before reading.
    expect(screen.getByRole("button", { name: REFRESH })).toBeInTheDocument();

    // Taking a known word back leaves something to practise.
    await user.click(screen.getByText("1 word you already know"));
    await user.click(screen.getByRole("button", { name: "Undo: hedge" }));
    expect(
      await screen.findByRole("button", { name: "Practice" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 word to learn")).toBeInTheDocument();
    expect(screen.queryByText("Ready to read")).toBeNull();
    expect(screen.queryByRole("button", { name: REFRESH })).toBeNull();
  });

  test("the refresh is offered only on a chapter that is ready to read", async () => {
    seedMockReadiness();
    const user = userEvent.setup();
    await openChapter(user, "I. Down the Rabbit-Hole");
    expect(await screen.findByText("7 words to learn")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: REFRESH })).toBeNull();

    // Partly done: there are done words, and words still to practise.
    await user.click(
      screen.getByRole("button", { name: "Alice's Adventures in Wonderland" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "III. A Caucus-Race and a Long Tale",
      }),
    );
    expect(await screen.findAllByRole("img", { name: "Done" })).toHaveLength(5);
    // The bar over the list says how far the chapter's words have come.
    const open = screen.getAllByRole("button", { name: /^I know this/u });
    expect(screen.getByText("5 learned")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", {
        name: "Words learned in this chapter",
      }),
    ).toHaveAttribute(
      "aria-valuenow",
      String(Math.floor((5 / (5 + open.length)) * 100)),
    );
    expect(
      screen.getByRole("button", { name: "Practice" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: REFRESH })).toBeNull();
  });

  test("a ready chapter whose words are all known has nothing to refresh", async () => {
    seedMockReadiness();
    for (const lemma of ["waistcoat", "marmalade", "peep"]) {
      setMockWordKnown(lemma, true);
    }
    const user = userEvent.setup();
    await openChapter(user, "II. The Pool of Tears");

    expect(await screen.findByText("Ready to read")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: REFRESH })).toBeNull();
  });

  test("a failed preparation says so and can be tried again", async () => {
    const user = userEvent.setup();
    await openChapter(user, "V. Advice from a Caterpillar");

    await user.click(screen.getByRole("button", { name: /Relevant words/u }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong: Claude took too long to answer",
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("8 words to learn")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a chapter that is not in English is refused, with nothing to retry", async () => {
    const user = userEvent.setup();
    await openChapter(user, "II. The Pool of Tears");
    setMockChapterRefusal("notEnglish");

    await user.click(screen.getByRole("button", { name: /Most words/u }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This chapter isn't in English, so Ogmios can't prepare its words.",
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  test("the choice, the progress and the list are in Spanish too", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("es");
    await openChapter(user, "II. The Pool of Tears");
    setMockLatency(0.03);

    expect(
      screen.getByRole("heading", {
        name: "¿Cuántas palabras quieres aprender?",
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Las más difíciles/u }),
    );
    expect(await screen.findByText("Leyendo el capítulo…")).toBeInTheDocument();
    expect(await screen.findByText("Parte 2 de 3")).toBeInTheDocument();
    expect(
      await screen.findByText("4 palabras por aprender"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("columnheader").map((heading) => heading.textContent),
    ).toEqual(["Palabra", "Traducción", "Veces en el capítulo", "Ya la sé"]);
    expect(
      screen.getByRole("button", { name: "Ya la sé: hedge" }),
    ).toBeInTheDocument();

    setMockChapterRefusal("notEnglish");
    await user.click(screen.getByRole("button", { name: /La mayoría/u }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este capítulo no está en inglés, así que Ogmios no puede preparar sus palabras.",
    );
  });
});
