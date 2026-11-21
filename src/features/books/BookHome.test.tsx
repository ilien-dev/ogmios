import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Book } from "@shared/domain";
import type { BookTab, Route } from "@/app/routes";
import { SpeechProvider } from "@/features/speech/speech";
import { i18n } from "@/lib/i18n/i18n";
import { listBooks } from "@/lib/ipc";
import { useMockBackend } from "@/test/mockBackend";
import { BookHome } from "./BookHome";
import { currentOf } from "./currentChapter";

async function shelf(): Promise<{ books: Book[]; book: Book }> {
  const books = await listBooks();
  const book = books.find((one) => one.chapters.length > 1);
  if (book === undefined) {
    throw new Error("The mock shelf has no book with chapters.");
  }
  return { books, book };
}

interface PlaceProps {
  books: Book[];
  /** The chapter the learner is on when it opens. */
  start: string;
  tab?: BookTab;
  /** Told of every chapter picked. */
  onPicked?: (chapterId: string) => void;
}

/** The book's screen with what the app holds for it: the tab and the chapter. */
function Place({
  books,
  start,
  tab = "words",
  onPicked,
}: PlaceProps): ReactNode {
  const [on, setOn] = useState(start);
  const [route, setRoute] = useState<Route>({ name: "book", tab });
  if (route.name !== "book") {
    return <p>{`Left for ${route.name}`}</p>;
  }
  return (
    <SpeechProvider>
      <BookHome
        loaded
        books={books}
        current={currentOf(books, on)}
        tab={route.tab ?? "words"}
        nativeLang="es"
        navigate={setRoute}
        onPick={(chapterId) => {
          onPicked?.(chapterId);
          setOn(chapterId);
        }}
      />
    </SpeechProvider>
  );
}

function chart(): HTMLElement {
  return screen.getByRole("region", { name: "Vocabulary by chapter" });
}

function list(): HTMLElement {
  return screen.getByRole("region", { name: "Chapters" });
}

function bars(): HTMLElement[] {
  return within(chart()).getAllByRole("button", { name: /words long/u });
}

describe("BookHome", () => {
  useMockBackend();

  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  test("while the shelf is read, it does not say there is no book", () => {
    render(
      <BookHome
        loaded={false}
        books={[]}
        current={null}
        tab="words"
        nativeLang="es"
        navigate={mock()}
        onPick={mock()}
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "Add your first book" }),
    ).toBeNull();
  });

  test("with no book, it asks for one and leads to the library", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(
      <BookHome
        loaded
        books={[]}
        current={null}
        tab="words"
        nativeLang="es"
        navigate={navigate}
        onPick={mock()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Add your first book" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add a book" }));
    expect(navigate).toHaveBeenCalledWith({ name: "books", bookId: null });
  });

  test("a bar, a row and a block each pick the chapter, for the whole screen", async () => {
    const user = userEvent.setup();
    const picked = mock();
    const { books, book } = await shelf();
    const [first, second, third] = book.chapters;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("The mock book has fewer than three chapters.");
    }
    render(<Place books={books} start={first.id} onPicked={picked} />);

    expect(bars().length).toBe(Math.min(12, book.chapters.length));
    expect(bars()[0]).toHaveAttribute("aria-pressed", "true");
    const rows = within(list()).getAllByRole("button");
    expect(rows[0]).toHaveAttribute("aria-pressed", "true");

    // A bar of the chart.
    await user.click(bars()[1] as HTMLElement);
    expect(picked).toHaveBeenLastCalledWith(second.id);
    expect(bars()[1]).toHaveAttribute("aria-pressed", "true");
    expect(bars()[0]).toHaveAttribute("aria-pressed", "false");
    expect(within(list()).getAllByRole("button")[1]).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // A row of the list.
    await user.click(within(list()).getAllByRole("button")[2] as HTMLElement);
    expect(picked).toHaveBeenLastCalledWith(third.id);
    expect(bars()[2]).toHaveAttribute("aria-pressed", "true");

    // A block of the relief.
    const relief = await screen.findByRole("img", {
      name: /chapters as 3D blocks/u,
    });
    const block = [...relief.querySelectorAll("g.cursor-pointer")].find(
      (each) => each.textContent === "1",
    );
    if (block === undefined) throw new Error("no block for chapter 1");
    await user.click(block);
    expect(picked).toHaveBeenLastCalledWith(first.id);
    expect(bars()[0]).toHaveAttribute("aria-pressed", "true");
    expect(within(list()).getAllByRole("button")[0]).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("the chapter has four tabs, on its words first, with the next step marked", async () => {
    const { books, book } = await shelf();
    const [first] = book.chapters;
    if (first === undefined) throw new Error("no chapter");
    render(<Place books={books} start={first.id} />);

    const tabs = within(
      screen.getByRole("tablist", { name: /^What to do with/u }),
    ).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      expect.stringContaining("Words"),
      expect.stringContaining("Listen"),
      expect.stringContaining("Translate"),
      expect.stringContaining("Write"),
    ]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    // A chapter with words still to learn asks for them next.
    expect(tabs[0]).toHaveTextContent("Next");
    expect(tabs[1]).not.toHaveTextContent("Next");
    // The words of the chapter are under the scene.
    expect(
      await screen.findByRole("region", { name: /^Words:/u }),
    ).toBeVisible();
  });

  test("picking another chapter keeps the tab", async () => {
    const user = userEvent.setup();
    const { books, book } = await shelf();
    const [first, second] = book.chapters;
    if (first === undefined || second === undefined) {
      throw new Error("The mock book has fewer than two chapters.");
    }
    render(<Place books={books} start={first.id} />);

    await user.click(screen.getByRole("tab", { name: /Translate/u }));
    expect(screen.getByRole("tab", { name: /Translate/u })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      await screen.findByRole("button", { name: /From English into/u }),
    ).toBeVisible();

    await user.click(bars()[1] as HTMLElement);

    expect(screen.getByRole("tab", { name: /Translate/u })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      await screen.findByRole("region", { name: /^Translate:/u }),
    ).toBeVisible();
    expect(
      await screen.findByRole("button", { name: /From English into/u }),
    ).toBeVisible();
  });

  test("each tab shows what it does with the chapter", async () => {
    const user = userEvent.setup();
    const { books, book } = await shelf();
    const [first] = book.chapters;
    if (first === undefined) throw new Error("no chapter");
    render(<Place books={books} start={first.id} />);

    await user.click(screen.getByRole("tab", { name: /Listen/u }));
    expect(
      await screen.findByRole("heading", { name: "Listening" }),
    ).toBeVisible();

    await user.click(screen.getByRole("tab", { name: /Write/u }));
    expect(
      await screen.findByRole("heading", { name: "Chapter structures" }),
    ).toBeVisible();
  });

  test("the book is changed in the library", async () => {
    const user = userEvent.setup();
    const { books, book } = await shelf();
    const [first] = book.chapters;
    if (first === undefined) throw new Error("no chapter");
    render(<Place books={books} start={first.id} />);

    await user.click(screen.getByRole("button", { name: "Change book" }));
    expect(screen.getByText("Left for books")).toBeVisible();
  });

  test("is in Spanish too", async () => {
    await i18n.changeLanguage("es");
    const { books, book } = await shelf();
    const [first] = book.chapters;
    if (first === undefined) throw new Error("no chapter");
    render(<Place books={books} start={first.id} />);

    expect(
      screen.getByRole("region", { name: "Vocabulario por capítulo" }),
    ).toBeVisible();
    expect(screen.getByRole("region", { name: "Capítulos" })).toBeVisible();
    expect(
      within(screen.getByRole("tablist")).getAllByRole("tab"),
    ).toHaveLength(4);
    expect(screen.getByRole("tab", { name: /Escribir/u })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cambiar libro" })).toBeVisible();
  });
});
