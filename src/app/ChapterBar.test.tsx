import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { Book } from "@shared/domain";
import type { Current } from "@/features/books/currentChapter";
import { i18n } from "@/lib/i18n/i18n";
import { useMockBackend } from "@/test/mockBackend";
import { ChapterBar } from "./ChapterBar";
import type { Route } from "./routes";

const BOOK: Book = {
  id: "b",
  title: "Alice",
  author: null,
  opening: "",
  chapters: [
    {
      id: "c1",
      index: 0,
      title: "One",
      words: 10,
      prepared: null,
      readiness: null,
    },
    {
      id: "c2",
      index: 1,
      title: "Two",
      words: 10,
      prepared: null,
      readiness: null,
    },
  ],
};
const OTHER: Book = {
  id: "o",
  title: "Emma",
  author: null,
  opening: "",
  chapters: [
    {
      id: "e1",
      index: 0,
      title: "",
      words: 10,
      prepared: null,
      readiness: null,
    },
  ],
};
const CURRENT: Current = {
  book: BOOK,
  chapter: BOOK.chapters[1] as Current["chapter"],
};

const RECALL: Route = { name: "recall" };
const TITLE = { name: "Current chapter: Two" };

interface BarProps {
  route: Route;
  navigate?: (route: Route) => void;
  books?: readonly Book[];
  current?: Current | null;
}

function Bar({
  route,
  navigate = mock(),
  books = [],
  current = null,
}: BarProps): ReactNode {
  return (
    <ChapterBar
      route={route}
      navigate={navigate}
      books={books}
      current={current}
    />
  );
}

describe("ChapterBar", () => {
  useMockBackend();

  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  test("it shows only over the book section, and only with chapters to pick", () => {
    const { container, rerender } = render(
      <Bar route={{ name: "home" }} books={[BOOK]} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<Bar route={RECALL} books={[]} />);
    expect(container).toBeEmptyDOMElement();

    rerender(
      <Bar route={{ name: "recall", running: "both" }} books={[BOOK]} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<Bar route={{ name: "book" }} books={[BOOK]} />);
    expect(
      screen.getByRole("button", { name: "Pick a chapter" }),
    ).toBeVisible();
  });

  test("the chapter title opens the picker and picking opens that chapter", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(
      <Bar
        route={RECALL}
        navigate={navigate}
        books={[BOOK, OTHER]}
        current={CURRENT}
      />,
    );

    expect(screen.queryByRole("listbox")).toBeNull();
    await user.click(screen.getByRole("button", TITLE));

    const list = screen.getByRole("listbox", { name: "Current chapter" });
    expect(within(list).getByRole("group", { name: "Alice" })).toBeVisible();
    expect(within(list).getByText("Alice")).toBeVisible();
    expect(within(list).getByRole("option", { name: "Two" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      within(list).getByRole("option", { name: "Section 1" }),
    ).toBeVisible();

    await user.click(within(list).getByRole("option", { name: "One" }));
    expect(navigate).toHaveBeenCalledWith({
      name: "books",
      bookId: "b",
      chapterId: "c1",
    });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("with books and no chapter on, the title asks for one", async () => {
    const user = userEvent.setup();
    render(<Bar route={RECALL} books={[BOOK]} />);

    await user.click(screen.getByRole("button", { name: "Pick a chapter" }));
    expect(screen.getByRole("listbox")).toBeVisible();
    expect(screen.getByRole("option", { name: "One" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  test("the picker moves with the arrows and picks with Enter", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(
      <Bar
        route={RECALL}
        navigate={navigate}
        books={[BOOK, OTHER]}
        current={CURRENT}
      />,
    );

    await user.click(screen.getByRole("button", TITLE));
    expect(screen.getByRole("listbox")).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}{Enter}");

    expect(navigate).toHaveBeenCalledWith({
      name: "books",
      bookId: "b",
      chapterId: "c1",
    });
  });

  test("the arrows cross the books and stop at the end of the list", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(
      <Bar
        route={RECALL}
        navigate={navigate}
        books={[BOOK, OTHER]}
        current={CURRENT}
      />,
    );

    await user.click(screen.getByRole("button", TITLE));
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");

    expect(navigate).toHaveBeenCalledWith({
      name: "books",
      bookId: "o",
      chapterId: "e1",
    });
  });

  test("Escape puts the picker away and hands the focus back", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(
      <Bar
        route={RECALL}
        navigate={navigate}
        books={[BOOK]}
        current={CURRENT}
      />,
    );
    const title = screen.getByRole("button", TITLE);

    await user.click(title);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(title).toHaveFocus();
    expect(navigate).not.toHaveBeenCalled();
  });

  test("a click outside puts the picker away", async () => {
    const user = userEvent.setup();
    render(<Bar route={RECALL} books={[BOOK]} current={CURRENT} />);

    await user.click(screen.getByRole("button", TITLE));
    await user.click(document.body);

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("pressing the title again puts the picker away", async () => {
    const user = userEvent.setup();
    render(<Bar route={RECALL} books={[BOOK]} current={CURRENT} />);
    const title = screen.getByRole("button", TITLE);

    await user.click(title);
    await user.click(title);

    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
