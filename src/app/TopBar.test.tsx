import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { Book } from "@shared/domain";
import type { Current } from "@/features/books/currentChapter";
import { UpdateContext } from "@/features/update/update";
import type { UpdateState, Updates } from "@/features/update/update";
import { i18n } from "@/lib/i18n/i18n";
import { useMockBackend } from "@/test/mockBackend";
import type { Entry } from "./places";
import { entryOf } from "./places";
import type { Route } from "./routes";
import { chapterOn } from "./routes";
import { TopBar } from "./TopBar";

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

const ROUTES: Array<[Route, Entry | "settings"]> = [
  [{ name: "home" }, "home"],
  [{ name: "setup", preset: null }, "conversation"],
  [
    { name: "report", sessionId: "s", report: null, origin: "session" },
    "conversation",
  ],
  [
    { name: "practice", patternId: null, format: null, autostart: false },
    "drills",
  ],
  [{ name: "progress" }, "progress"],
  [
    { name: "report", sessionId: "s", report: null, origin: "progress" },
    "progress",
  ],
  [{ name: "books", bookId: null }, "books"],
  [{ name: "books", bookId: null, known: true }, "books"],
  [{ name: "books", bookId: "b" }, "books"],
  [{ name: "books", bookId: "b", chapterId: "c" }, "vocabulary"],
  [
    { name: "books", bookId: "b", chapterId: "c", translating: true },
    "translate",
  ],
  [{ name: "recall" }, "recall"],
  [{ name: "structures" }, "structures"],
  [{ name: "listening" }, "listening"],
  [{ name: "settings" }, "settings"],
];

const SETUP: Route = { name: "setup", preset: null };
const RECALL: Route = { name: "recall" };
const TITLE = { name: "Current chapter: Two" };

interface BarProps {
  route: Route;
  navigate?: (route: Route) => void;
  counts?: Partial<Record<Entry, number>>;
  books?: readonly Book[];
  current?: Current | null;
}

function Bar({
  route,
  navigate = mock(),
  counts = {},
  books = [],
  current = null,
}: BarProps): ReactNode {
  return (
    <TopBar
      route={route}
      navigate={navigate}
      counts={counts}
      books={books}
      current={current}
    />
  );
}

function names(nav: HTMLElement): string[] {
  return within(nav)
    .getAllByRole("button")
    .map((button) => button.textContent);
}

function updates(state: UpdateState, folded: boolean): Updates {
  return {
    version: "1.0.0",
    state,
    folded,
    check: mock(),
    download: mock(),
    restart: mock(),
    later: mock(),
    unfold: mock(),
  };
}

describe("chapterOn", () => {
  test("the chapter on the screen goes before the one opened last", () => {
    expect(chapterOn({ name: "books", bookId: "b", chapterId: "c" }, "o")).toBe(
      "c",
    );
  });

  test("any other screen is on the one opened last", () => {
    expect(chapterOn({ name: "books", bookId: "b" }, "o")).toBe("o");
    expect(chapterOn({ name: "home" }, null)).toBeNull();
  });
});

describe("TopBar", () => {
  useMockBackend();

  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  test.each(ROUTES)("the screen %j belongs to %s", (route, entry) => {
    expect(entryOf(route)).toBe(entry);
  });

  test("conversation shows its 3 places and book its 6", () => {
    const { rerender } = render(<Bar route={SETUP} />);

    expect(
      names(screen.getByRole("navigation", { name: "Conversation" })),
    ).toEqual(["Chat", "Drills", "Progress"]);
    expect(screen.queryByRole("navigation", { name: "Book" })).toBeNull();

    rerender(<Bar route={RECALL} />);

    expect(names(screen.getByRole("navigation", { name: "Book" }))).toEqual([
      "Vocabulary",
      "Translate",
      "Structures",
      "Listening",
      "Daily review",
      "Books",
    ]);
    expect(
      screen.queryByRole("navigation", { name: "Conversation" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  test("there is no bar on Home nor on a screen that takes the whole window", () => {
    const { container, rerender } = render(<Bar route={{ name: "home" }} />);
    expect(container).toBeEmptyDOMElement();

    rerender(<Bar route={{ name: "recall", running: "both" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("Settings has the way back and its own place, and no others", () => {
    render(<Bar route={{ name: "settings" }} />);

    expect(screen.getByRole("button", { name: "Home" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  test("the back arrow goes home", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Bar route={RECALL} navigate={navigate} />);

    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(navigate).toHaveBeenCalledWith({ name: "home" });
  });

  test("Settings is one click away", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Bar route={RECALL} navigate={navigate} />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(navigate).toHaveBeenCalledWith({ name: "settings" });
  });

  test("the place of the screen is marked with aria-current", () => {
    render(<Bar route={RECALL} />);

    expect(
      screen.getByRole("button", { name: "Daily review" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("button", { name: "Structures" }),
    ).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  test("what is due shows on its place", () => {
    const { rerender } = render(
      <Bar route={SETUP} counts={{ drills: 3, recall: 12 }} />,
    );
    expect(
      screen.getByRole("button", { name: "Drills, 3 due today" }),
    ).toHaveTextContent("3");

    rerender(<Bar route={RECALL} counts={{ drills: 3, recall: 12 }} />);
    expect(
      screen.getByRole("button", { name: "Daily review, 12 due today" }),
    ).toHaveTextContent("12");
  });

  test("the places of a chapter open on the current one", async () => {
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

    await user.click(screen.getByRole("button", { name: "Vocabulary" }));
    expect(navigate).toHaveBeenLastCalledWith({
      name: "books",
      bookId: "b",
      chapterId: "c2",
    });
    await user.click(screen.getByRole("button", { name: "Translate" }));
    expect(navigate).toHaveBeenLastCalledWith({
      name: "books",
      bookId: "b",
      chapterId: "c2",
      translating: true,
    });
    await user.click(screen.getByRole("button", { name: "Listening" }));
    expect(navigate).toHaveBeenLastCalledWith({
      name: "listening",
      chapterId: "c2",
    });
  });

  test("with no chapter, Vocabulary, Translate and Listening lead to the shelf", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Bar route={RECALL} navigate={navigate} />);

    expect(screen.queryByRole("button", { name: "Pick a chapter" })).toBeNull();
    for (const name of ["Vocabulary", "Translate", "Listening"]) {
      await user.click(screen.getByRole("button", { name }));
      expect(navigate).toHaveBeenLastCalledWith({
        name: "books",
        bookId: null,
      });
    }
    await user.click(screen.getByRole("button", { name: "Structures" }));
    expect(navigate).toHaveBeenLastCalledWith({ name: "structures" });
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
    await user.click(screen.getByRole("button", { name: "Books" }));

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

  test("under 1000px, pills show only an icon and keep their name", () => {
    render(<Bar route={RECALL} counts={{ recall: 2 }} />);

    for (const name of [
      "Vocabulary",
      "Translate",
      "Structures",
      "Listening",
      "Books",
    ]) {
      // `display: none` takes a text out of the name: it has to be the pill's own.
      const pill = screen.getByRole("button", { name });
      expect(pill).toHaveAttribute("aria-label", name);
      expect(within(pill).getByText(name)).toHaveClass("hidden", "nav:inline");
    }
    expect(
      screen.getByRole("button", { name: "Daily review, 2 due today" }),
    ).toHaveAttribute("aria-label", "Daily review, 2 due today");
  });

  test("a chat starts from its own setup", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Bar route={SETUP} navigate={navigate} />);

    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(navigate).toHaveBeenCalledWith({ name: "setup", preset: null });
  });

  test("a dismissed update puts a dot on Settings", () => {
    const available: UpdateState = { kind: "available", version: "9.0.0" };
    const bar = (value: Updates): ReactNode => (
      <UpdateContext.Provider value={value}>
        <Bar route={RECALL} />
      </UpdateContext.Provider>
    );
    const { rerender } = render(bar(updates(available, false)));
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();

    rerender(bar(updates({ kind: "current" }, true)));
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();

    rerender(bar(updates(available, true)));
    expect(
      screen.getByRole("button", { name: "Settings, an update is waiting" }),
    ).toBeVisible();
  });

  test("is in Spanish too", async () => {
    await i18n.changeLanguage("es");
    const { rerender } = render(<Bar route={SETUP} />);

    expect(
      screen.getByRole("navigation", { name: "Conversación" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Inicio" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Charla" })).toBeVisible();

    rerender(<Bar route={RECALL} />);

    expect(screen.getByRole("navigation", { name: "Libro" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Repaso diario" })).toBeVisible();
  });
});
