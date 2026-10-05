import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { Route } from "@/app/routes";
import { showsNav } from "@/app/routes";
import { i18n } from "@/lib/i18n/i18n";
import { seedMockReadiness } from "@/lib/ipcMockChapters";
import { useMockBackend } from "@/test/mockBackend";
import { BooksScreen } from "./BooksScreen";

const CHAPTER = "I. Down the Rabbit-Hole";

/** The books section on the book of the mock, as the app holds it. */
function Shelf(): ReactNode {
  const [route, setRoute] = useState<Route>({
    name: "books",
    bookId: "book-alice",
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
        triage={route.triage === true}
        navigate={setRoute}
      />
    </>
  );
}

/** The chapter of the mock with eight words to learn, its sorting started. */
async function sort(start = "Sort the list"): Promise<UserEvent> {
  const user = userEvent.setup();
  render(<Shelf />);
  await user.click(await screen.findByRole("button", { name: CHAPTER }));
  await user.click(await screen.findByRole("button", { name: start }));
  return user;
}

/** Waits for the card of that word. */
async function shows(lemma: string): Promise<void> {
  expect(
    await screen.findByRole("heading", { level: 1, name: lemma }),
  ).toBeInTheDocument();
}

function bar(): number {
  return Number(
    screen
      .getByRole("progressbar", { name: "Session progress" })
      .getAttribute("aria-valuenow"),
  );
}

describe("sorting a chapter's words into known and not", () => {
  useMockBackend();

  test("each key settles the word on the card and brings the next one", async () => {
    const user = await sort();

    // The whole window: the word, its translations, and how often it comes.
    await shows("rabbit hole");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText("madriguera")).toBeInTheDocument();
    expect(screen.getByText("6 times in the chapter")).toBeInTheDocument();
    expect(screen.getByText("1 / 8")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(bar()).toBe(0);
    expect(screen.getByText("0 to learn")).toBeInTheDocument();
    expect(screen.getByText("0 known")).toBeInTheDocument();

    await user.keyboard("a");
    await shows("tumble");
    expect(screen.getByText("caerse, rodar")).toBeInTheDocument();
    expect(bar()).toBe(12);
    await user.keyboard("d");
    await shows("curtsey");
    expect(screen.getByText("1 to learn")).toBeInTheDocument();
    expect(screen.getByText("1 known")).toBeInTheDocument();

    // The rest by the arrows, and a capital is the same key.
    await user.keyboard("{ArrowLeft}");
    for (const [at, key] of ["{ArrowRight}", "D", "d", "d"].entries()) {
      await screen.findByText(`${String(at + 4)} / 8`);
      await user.keyboard(key);
    }
    await screen.findByText("8 / 8");
    await user.keyboard("A");

    expect(
      await screen.findByRole("heading", { name: "List sorted" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 words you already knew")).toBeInTheDocument();
    expect(screen.getByText("5 words to learn")).toBeInTheDocument();
    expect(bar()).toBe(100);
    expect(screen.getByRole("button", { name: "Practice" })).toHaveFocus();

    await user.click(
      screen.getByRole("button", { name: "Back to the chapter" }),
    );
    expect(await screen.findByText("5 words to learn")).toBeInTheDocument();
    expect(screen.getByText("3 words you already know")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  test("undo goes back a word and takes its mark with it", async () => {
    const user = await sort();
    await shows("rabbit hole");
    await user.click(screen.getByRole("button", { name: "I know this" }));
    await shows("tumble");
    await user.click(screen.getByRole("button", { name: "Don't know it" }));
    await shows("curtsey");

    await user.keyboard("z");
    await shows("tumble");
    expect(screen.getByText("0 to learn")).toBeInTheDocument();
    expect(screen.getByText("1 known")).toBeInTheDocument();
    await user.keyboard("{Backspace}");
    await shows("rabbit hole");
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

    // Left with Escape: the mark undone is not kept.
    await user.keyboard("{Escape}");
    expect(await screen.findByText("8 words to learn")).toBeInTheDocument();
    expect(screen.queryByText(/already know/u)).toBeNull();
  });

  test("leaving halfway keeps the words marked, and the next pass skips them", async () => {
    const user = await sort();
    await shows("rabbit hole");
    await user.keyboard("a");
    await shows("tumble");
    await user.click(screen.getByRole("button", { name: "Leave sorting" }));

    expect(await screen.findByText("7 words to learn")).toBeInTheDocument();
    expect(screen.getByText("1 word you already know")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sort the list" }));
    await shows("tumble");
    expect(screen.getByText("1 / 7")).toBeInTheDocument();
  });

  test("a sorting left halfway is taken up at the word it stopped on", async () => {
    const user = await sort();
    await shows("rabbit hole");
    await user.keyboard("d");
    await shows("tumble");
    await user.keyboard("a");
    await shows("curtsey");
    await user.keyboard("{Escape}");

    expect(await screen.findByText("7 words to learn")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sort the list" }));
    await shows("curtsey");
    expect(screen.getByText("2 / 7")).toBeInTheDocument();
    expect(screen.getByText("1 to learn")).toBeInTheDocument();
    // The word known on the earlier visit still counts.
    expect(screen.getByText("1 known")).toBeInTheDocument();
    expect(bar()).toBe(14);
    // Nothing of this visit to take back yet.
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

    // A word left to learn and then taken back is asked again next time.
    await user.keyboard("d");
    await shows("waistcoat");
    await user.keyboard("z");
    await shows("curtsey");
    await user.keyboard("{Escape}");
    await user.click(
      await screen.findByRole("button", { name: "Sort the list" }),
    );
    await shows("curtsey");
  });

  test("a list gone through to its end says so, and offers another pass", async () => {
    const user = await sort();
    await shows("rabbit hole");
    await user.keyboard("a");
    for (let at = 2; at <= 8; at += 1) {
      await screen.findByText(`${String(at)} / 8`);
      await user.keyboard("d");
    }
    await user.click(
      await screen.findByRole("button", { name: "Back to the chapter" }),
    );

    await user.click(
      await screen.findByRole("button", { name: "Sort the list" }),
    );
    expect(
      await screen.findByRole("heading", { name: "List sorted" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You already went through this whole list."),
    ).toBeInTheDocument();
    expect(screen.getByText("7 words to learn")).toBeInTheDocument();
    expect(bar()).toBe(100);
    expect(screen.getByRole("button", { name: "Practice" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();

    // Another pass asks the words left to learn again, from the first.
    await user.click(screen.getByRole("button", { name: "Another pass" }));
    await shows("tumble");
    expect(screen.getByText("1 / 7")).toBeInTheDocument();
    expect(screen.getByText("0 to learn")).toBeInTheDocument();
    expect(screen.getByText("1 known")).toBeInTheDocument();
    expect(bar()).toBe(0);
    await user.keyboard("a");
    await shows("curtsey");
    expect(screen.getByText("2 known")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(
      await screen.findByRole("button", { name: "Sort the list" }),
    );
    await shows("curtsey");
    expect(screen.getByText("1 / 6")).toBeInTheDocument();
  });

  test("the summary can undo its last word", async () => {
    const user = await sort();
    for (let at = 1; at <= 8; at += 1) {
      await screen.findByText(`${String(at)} / 8`);
      await user.keyboard("a");
    }
    expect(
      await screen.findByText("8 words you already knew"),
    ).toBeInTheDocument();
    expect(screen.getByText("Nothing left to learn here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Practice" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Back to the chapter" }),
    ).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("8 / 8")).toBeInTheDocument();
  });

  test("a chapter with nothing left to learn does not offer it", async () => {
    seedMockReadiness();
    const user = userEvent.setup();
    render(<Shelf />);
    await user.click(
      await screen.findByRole("button", { name: "II. The Pool of Tears" }),
    );
    expect(await screen.findByText("Ready to read")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sort the list" })).toBeNull();
  });

  test("is played to its summary in Spanish too", async () => {
    await i18n.changeLanguage("es");
    const user = await sort("Limpiar la lista");
    await shows("rabbit hole");
    expect(screen.getByText("6 veces en el capítulo")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Salir de la limpieza" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ya la sé" }));
    await shows("tumble");
    await user.click(screen.getByRole("button", { name: "No la sé" }));
    expect(await screen.findByText("1 por aprender")).toBeInTheDocument();
    expect(screen.getByText("1 que ya sé")).toBeInTheDocument();
    for (let at = 3; at <= 8; at += 1) {
      await screen.findByText(`${String(at)} / 8`);
      await user.keyboard("d");
    }

    expect(
      await screen.findByRole("heading", { name: "Lista limpia" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 palabra que ya sabías")).toBeInTheDocument();
    expect(screen.getByText("7 palabras por aprender")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Practicar" })).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Deshacer" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Volver al capítulo" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Limpiar la lista" }),
    );
    expect(
      await screen.findByText("Ya repasaste toda esta lista."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Otra pasada" }));
    await shows("tumble");
  });
});
