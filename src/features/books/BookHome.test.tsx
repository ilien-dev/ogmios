import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Book } from "@shared/domain";
import { i18n } from "@/lib/i18n/i18n";
import { listBooks, listKnownWords, recallState } from "@/lib/ipc";
import { useMockBackend } from "@/test/mockBackend";
import { BookHome } from "./BookHome";
import { currentOf } from "./currentChapter";
import type { Current } from "./currentChapter";

async function shelf(): Promise<{ books: Book[]; current: Current }> {
  const books = await listBooks();
  const book = books.find((one) => one.chapters.length > 1);
  const current = currentOf(books, book?.chapters[0]?.id ?? null);
  if (current === null) {
    throw new Error("The mock shelf has no book with chapters.");
  }
  return { books, current };
}

function chart(): HTMLElement {
  return screen.getByRole("region", { name: "Vocabulary by chapter" });
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
        counts={{}}
        nativeLang="es"
        navigate={mock()}
      />,
    );

    expect(
      screen.queryByRole("heading", { name: "Add your first book" }),
    ).toBeNull();
  });

  test("with no book, it asks for one and leads to the shelf", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(
      <BookHome
        loaded
        books={[]}
        current={null}
        counts={{}}
        nativeLang="es"
        navigate={navigate}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Add your first book" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add a book" }));
    expect(navigate).toHaveBeenCalledWith({ name: "books", bookId: null });
  });

  test("the chart starts on the current chapter, and a bar picks another", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    const { books, current } = await shelf();
    render(
      <BookHome
        loaded
        books={books}
        current={current}
        counts={{}}
        nativeLang="es"
        navigate={navigate}
      />,
    );

    const bars = within(chart()).getAllByRole("button", {
      name: /words long/u,
    });
    expect(bars.length).toBe(Math.min(12, current.book.chapters.length));
    expect(bars[0]).toHaveAttribute("aria-pressed", "true");

    const other = current.book.chapters[1];
    if (other === undefined) throw new Error("no second chapter");
    await user.click(bars[1] as HTMLElement);
    expect(bars[1]).toHaveAttribute("aria-pressed", "true");
    expect(bars[0]).toHaveAttribute("aria-pressed", "false");

    await user.click(
      within(chart()).getByRole("button", {
        name: other.readiness === null ? "Prepare it" : "Study its words",
      }),
    );
    expect(navigate).toHaveBeenLastCalledWith({
      name: "books",
      bookId: current.book.id,
      chapterId: other.id,
    });
  });

  test("translating opens the picked chapter's translation", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    const { books, current } = await shelf();
    render(
      <BookHome
        loaded
        books={books}
        current={current}
        counts={{}}
        nativeLang="es"
        navigate={navigate}
      />,
    );

    const translate = screen.getByRole("region", { name: "Translate" });
    await user.click(within(translate).getByRole("button"));
    expect(navigate).toHaveBeenCalledWith({
      name: "books",
      bookId: current.book.id,
      chapterId: current.chapter.id,
      translating: true,
    });
  });

  test("the review says what is due and opens it", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    const { books, current } = await shelf();
    render(
      <BookHome
        loaded
        books={books}
        current={current}
        counts={{ recall: 7 }}
        nativeLang="es"
        navigate={navigate}
      />,
    );

    const review = screen.getByRole("region", { name: "Daily review" });
    expect(review).toHaveTextContent("7 words are waiting today");
    await user.click(
      within(review).getByRole("button", { name: "Review 7 words" }),
    );
    expect(navigate).toHaveBeenCalledWith({ name: "recall" });
  });

  test("your words count the learned ones and the ones known before", async () => {
    const { books, current } = await shelf();
    const [state, known] = await Promise.all([recallState(), listKnownWords()]);
    const learned = state.fresh + state.settling + state.firm;
    render(
      <BookHome
        loaded
        books={books}
        current={current}
        counts={{}}
        nativeLang="es"
        navigate={mock()}
      />,
    );

    const words = screen.getByRole("region", { name: "Your words" });
    expect(
      await within(words).findByText(`${String(learned)} learned here`, {
        exact: false,
      }),
    ).toBeVisible();
    expect(words).toHaveTextContent(String(learned + known.length));
  });

  test("is in Spanish too", async () => {
    await i18n.changeLanguage("es");
    const { books, current } = await shelf();
    render(
      <BookHome
        loaded
        books={books}
        current={current}
        counts={{ recall: 2 }}
        nativeLang="es"
        navigate={mock()}
      />,
    );

    expect(
      screen.getByRole("region", { name: "Vocabulario por capítulo" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Repasar 2 palabras" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Cambiar libro" })).toBeVisible();
  });
});
