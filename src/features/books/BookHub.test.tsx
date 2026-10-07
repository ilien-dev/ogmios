import { describe, expect, mock, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Book } from "@shared/domain";
import { i18n } from "@/lib/i18n/i18n";
import {
  allMockChapters,
  clearMockBooks,
  mockBookId,
} from "@/lib/ipcMockBooks";
import { setMockWordKnown } from "@/lib/ipcMockWords";
import { useMockBackend } from "@/test/mockBackend";
import { BookHub, currentOf } from "./BookHub";

/** The chapter the mock has the learner on, and its book. */
function current(): { bookId: string; chapterId: string } {
  const [chapter] = allMockChapters();
  const chapterId = chapter?.id ?? "";
  return { bookId: mockBookId(chapterId), chapterId };
}

describe("the book section", () => {
  useMockBackend();

  test("names the chapter the learner is on, with a way to change it", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<BookHub navigate={navigate} />);

    const on = await screen.findByRole("region", { name: "Current chapter" });
    expect(on).toHaveTextContent("Alice's Adventures in Wonderland");
    await user.click(within(on).getByRole("button", { name: "Change" }));
    expect(navigate).toHaveBeenCalledWith({
      name: "books",
      bookId: null,
      shelf: true,
    });
  });

  test("each card leads to what it names, on that chapter", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<BookHub navigate={navigate} />);
    const { bookId, chapterId } = current();

    await user.click(
      await screen.findByRole("button", { name: /^Vocabulary/u }),
    );
    expect(navigate).toHaveBeenLastCalledWith({
      name: "books",
      bookId,
      chapterId,
    });
    await user.click(
      screen.getByRole("button", { name: /^Translate the chapter/u }),
    );
    expect(navigate).toHaveBeenLastCalledWith({
      name: "books",
      bookId,
      chapterId,
      translating: true,
    });
    await user.click(screen.getByRole("button", { name: /^Daily review/u }));
    expect(navigate).toHaveBeenLastCalledWith({ name: "recall" });
    await user.click(screen.getByRole("button", { name: /^Listening/u }));
    expect(navigate).toHaveBeenLastCalledWith({ name: "listening", chapterId });
  });

  test("the quiet lines lead to the chapter's structures and the known words", async () => {
    setMockWordKnown("marmalade", true);
    const user = userEvent.setup();
    const navigate = mock();
    render(<BookHub navigate={navigate} />);
    const { bookId, chapterId } = current();

    await user.click(
      await screen.findByRole("button", { name: "See its structures" }),
    );
    expect(navigate).toHaveBeenLastCalledWith({
      name: "structures",
      chapterId,
      bookId,
    });
    await user.click(screen.getByRole("button", { name: "See them" }));
    expect(navigate).toHaveBeenLastCalledWith({
      name: "books",
      bookId: null,
      known: true,
    });
  });

  test("with no chapter opened it says what is missing and leads to the shelf", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    clearMockBooks();
    render(<BookHub navigate={navigate} />);

    await user.click(
      await screen.findByRole("button", { name: "Go to your books" }),
    );
    expect(navigate).toHaveBeenCalledWith({
      name: "books",
      bookId: null,
      shelf: true,
    });
    expect(screen.queryByRole("button", { name: /^Vocabulary/u })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Listening/u })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "See its structures" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /^Daily review/u }),
    ).toBeInTheDocument();
  });

  test("is in Spanish too", async () => {
    await i18n.changeLanguage("es");
    render(<BookHub navigate={mock()} />);

    expect(
      await screen.findByRole("button", { name: /^Vocabulario/u }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Traducir el capítulo/u }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Repaso diario/u }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Libro" })).toBeInTheDocument();
  });
});

describe("currentOf", () => {
  const book: Book = {
    id: "b",
    title: "A book",
    author: null,
    chapters: [
      {
        id: "c",
        index: 0,
        title: "",
        words: 10,
        prepared: null,
        readiness: null,
      },
    ],
  };

  test("finds the chapter with its book", () => {
    expect(currentOf([book], "c")?.book.id).toBe("b");
  });

  test("a chapter of a book that is gone, or none at all, is no chapter", () => {
    expect(currentOf([], "c")).toBeNull();
    expect(currentOf([book], null)).toBeNull();
  });
});
