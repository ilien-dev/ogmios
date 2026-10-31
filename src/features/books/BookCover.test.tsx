import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { Book } from "@shared/domain";
import { BookCover } from "./BookCover";

const BOOK: Book = {
  id: "no-file",
  title: "Emma",
  author: "Jane Austen",
  opening: "Emma Woodhouse, handsome, clever, and rich.",
  chapters: [],
};

describe("BookCover", () => {
  test("a book without a cover shows the page it opens with", async () => {
    render(<BookCover book={BOOK} />);
    expect(await screen.findByText(BOOK.opening)).toBeInTheDocument();
    expect(screen.getByText("Emma")).toBeInTheDocument();
    expect(screen.getByText("Jane Austen")).toBeInTheDocument();
  });

  test("it is a picture: the title beside it says what it is", async () => {
    const { container } = render(<BookCover book={BOOK} />);
    await screen.findByText(BOOK.opening);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
