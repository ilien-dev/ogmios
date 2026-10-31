import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Book } from "@shared/domain";
import type { Current } from "@/features/books/currentChapter";
import { i18n } from "@/lib/i18n/i18n";
import { useMockBackend } from "@/test/mockBackend";
import type { Route } from "./routes";
import { chapterOn } from "./routes";
import type { Entry } from "./Sidebar";
import { entryOf, Sidebar } from "./Sidebar";

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

function names(nav: HTMLElement): string[] {
  return within(nav)
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
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

describe("Sidebar", () => {
  useMockBackend();

  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  test.each(ROUTES)("the screen %j belongs to %s", (route, entry) => {
    expect(entryOf(route)).toBe(entry);
  });

  test("every place shows at once, each under one group", () => {
    render(
      <Sidebar
        route={{ name: "home" }}
        navigate={mock()}
        counts={{}}
        books={[BOOK]}
        current={CURRENT}
      />,
    );

    expect(
      names(screen.getByRole("navigation", { name: "Conversation" })),
    ).toEqual(["Chat", "Drills", "Progress"]);
    expect(names(screen.getByRole("navigation", { name: "Book" }))).toEqual([
      "Vocabulary",
      "Translate",
      "Structures",
      "Listening",
      "Daily review",
      "Books",
    ]);
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  test("the place of the screen is the marked one", () => {
    render(
      <Sidebar
        route={{ name: "recall" }}
        navigate={mock()}
        counts={{}}
        books={[]}
        current={null}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Daily review" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  test("what is due shows on its place", () => {
    render(
      <Sidebar
        route={{ name: "home" }}
        navigate={mock()}
        counts={{ drills: 3, recall: 12 }}
        books={[]}
        current={null}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Drills, 3 due today" }),
    ).toHaveTextContent("3");
    expect(
      screen.getByRole("button", { name: "Daily review, 12 due today" }),
    ).toHaveTextContent("12");
  });

  test("the places of a chapter open on the current one", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(
      <Sidebar
        route={{ name: "home" }}
        navigate={navigate}
        counts={{}}
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

  test("with no chapter they lead to the books; structures work without one", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(
      <Sidebar
        route={{ name: "home" }}
        navigate={navigate}
        counts={{}}
        books={[]}
        current={null}
      />,
    );

    expect(screen.queryByRole("combobox")).toBeNull();
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

  test("picking a chapter opens it", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(
      <Sidebar
        route={{ name: "recall" }}
        navigate={navigate}
        counts={{}}
        books={[BOOK]}
        current={CURRENT}
      />,
    );

    expect(screen.getByText("Alice")).toBeVisible();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Current chapter" }),
      "c1",
    );
    expect(navigate).toHaveBeenCalledWith({
      name: "books",
      bookId: "b",
      chapterId: "c1",
    });
  });

  test("a chat starts from its own setup", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(
      <Sidebar
        route={{ name: "home" }}
        navigate={navigate}
        counts={{}}
        books={[]}
        current={null}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(navigate).toHaveBeenCalledWith({ name: "setup", preset: null });
  });

  test("is in Spanish too", async () => {
    await i18n.changeLanguage("es");
    render(
      <Sidebar
        route={{ name: "home" }}
        navigate={mock()}
        counts={{}}
        books={[]}
        current={null}
      />,
    );

    expect(
      screen.getByRole("navigation", { name: "Conversación" }),
    ).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Libro" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Inicio" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Charla" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Repaso diario" })).toBeVisible();
  });
});
