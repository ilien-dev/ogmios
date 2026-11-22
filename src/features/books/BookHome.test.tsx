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

  test("the book is counted in three chips: chapters, ready and learning", async () => {
    const { books, book } = await shelf();
    const [first] = book.chapters;
    if (first === undefined) throw new Error("no chapter");
    render(<Place books={books} start={first.id} />);

    const ready = book.chapters.filter(
      (each) => (each.readiness ?? 0) >= 100,
    ).length;
    const learning = book.chapters.filter(
      (each) => each.readiness !== null && each.readiness < 100,
    ).length;
    for (const [count, label] of [
      [book.chapters.length, "chapters"],
      [ready, "ready"],
      [learning, "learning"],
    ] as const) {
      const chip = screen.getByText(label, { selector: "span.rounded-full" });
      expect(chip).toHaveTextContent(`${String(count)}${label}`);
    }
  });

  test("a bar, the search and a block each pick the chapter, for the whole screen", async () => {
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
    // The chapters are no longer listed beside the chart.
    expect(screen.queryByRole("region", { name: "Chapters" })).toBeNull();

    // A bar of the chart.
    await user.click(bars()[1] as HTMLElement);
    expect(picked).toHaveBeenLastCalledWith(second.id);
    expect(bars()[1]).toHaveAttribute("aria-pressed", "true");
    expect(bars()[0]).toHaveAttribute("aria-pressed", "false");

    // The list under the chapter's name, searched by number.
    await user.click(screen.getByRole("button", { name: "Choose a chapter" }));
    await user.keyboard("3{Enter}");
    expect(picked).toHaveBeenLastCalledWith(third.id);
    expect(bars()[2]).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("dialog")).toBeNull();

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
  });

  test("the list under the chapter's name opens on its field with every chapter, also on Ctrl+K", async () => {
    const user = userEvent.setup();
    const picked = mock();
    const { books, book } = await shelf();
    const [first, second] = book.chapters;
    if (first === undefined || second === undefined) {
      throw new Error("The mock book has fewer than two chapters.");
    }
    render(<Place books={books} start={first.id} onPicked={picked} />);

    const opener = screen.getByRole("button", { name: "Choose a chapter" });
    expect(opener).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Control>}k{/Control}");
    expect(opener).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("dialog", { name: "Find a chapter" });
    const field = within(list).getByRole("searchbox");
    expect(field).toHaveFocus();
    const rows = within(list).getAllByRole("button");
    expect(rows).toHaveLength(book.chapters.length);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(
      within(list).getByText(`${String(book.chapters.length)} chapters`),
    ).toBeVisible();

    // The arrows walk the rows and Enter picks the one with the focus.
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(rows[1]).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(field).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(picked).toHaveBeenLastCalledWith(second.id);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();

    // Escape closes it without picking, and a search that finds nothing says so.
    await user.click(opener);
    await user.keyboard("zzzz");
    expect(screen.getByText("No chapter matches.")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    // A click elsewhere closes it too.
    await user.click(opener);
    await user.click(screen.getByText(/^Chapter 2 of/u));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(picked).toHaveBeenCalledTimes(1);
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

  test("the panel opens with the tabs, then the chapter they work on", async () => {
    const user = userEvent.setup();
    const { books, book } = await shelf();
    const [first] = book.chapters;
    if (first === undefined) throw new Error("no chapter");
    render(<Place books={books} start={first.id} />);

    const panel = await screen.findByRole("region", { name: /^Words:/u });
    const tabs = within(panel).getByRole("tablist");
    const head = within(panel).getByRole("heading", {
      level: 2,
      name: first.title,
    });
    // The tabs come first, over the chapter's name.
    expect(
      tabs.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(panel).getByText(
        `Chapter 1 of ${book.chapters.length} · ${book.title}`,
      ),
    ).toBeVisible();

    // The chapter stays named over every tab.
    await user.click(screen.getByRole("tab", { name: /Listen/u }));
    const listen = await screen.findByRole("region", { name: /^Listen:/u });
    expect(
      within(listen).getByRole("heading", { level: 2, name: first.title }),
    ).toBeVisible();
  });

  test("the head steps to the chapter before or after, keeping the tab", async () => {
    const user = userEvent.setup();
    const { books, book } = await shelf();
    const [first, second] = book.chapters;
    const last = book.chapters.at(-1);
    if (first === undefined || second === undefined || last === undefined) {
      throw new Error("The mock book has fewer than two chapters.");
    }
    const picked = mock((_chapterId: string) => null);
    const { unmount } = render(
      <Place books={books} start={first.id} tab="write" onPicked={picked} />,
    );

    expect(
      screen.getByRole("button", { name: "Previous chapter" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next chapter" }));
    expect(picked).toHaveBeenLastCalledWith(second.id);
    expect(screen.getByRole("tab", { name: /Write/u })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Previous chapter" }));
    expect(picked).toHaveBeenLastCalledWith(first.id);
    unmount();

    render(<Place books={books} start={last.id} />);
    expect(screen.getByRole("button", { name: "Next chapter" })).toBeDisabled();
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
    expect(
      within(screen.getByRole("tablist")).getAllByRole("tab"),
    ).toHaveLength(4);
    expect(screen.getByRole("tab", { name: /Escribir/u })).toBeVisible();
    expect(
      screen.getByText(`Capítulo 1 de ${book.chapters.length} · ${book.title}`),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Elegir capítulo" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Capítulo siguiente" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Cambiar libro" })).toBeVisible();
  });
});
