import { describe, expect, mock, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { HomeState } from "@shared/domain";
import type { Entry } from "@/app/places";
import { currentOf } from "@/features/books/currentChapter";
import type { Current } from "@/features/books/currentChapter";
import { UpdateContext, useUpdate } from "@/features/update/update";
import { i18n } from "@/lib/i18n/i18n";
import { listBooks } from "@/lib/ipc";
import { setMockHome } from "@/lib/ipcMockHome";
import { useMockBackend } from "@/test/mockBackend";
import { Home } from "./Home";
import { todayLines } from "./homeLayout";

const NO_LINES = {
  activeChallenge: null,
  rotationSuggestion: null,
  levelSuggestion: null,
};

interface Shown {
  navigate?: ReturnType<typeof mock>;
  current?: Current | null;
  counts?: Partial<Record<Entry, number>>;
}

function show({ navigate = mock(), current = null, counts = {} }: Shown = {}) {
  return render(<Home navigate={navigate} current={current} counts={counts} />);
}

function started(name = "Start conversation"): Promise<HTMLElement> {
  return screen.findByRole("button", { name });
}

async function chapterOnTheShelf(): Promise<Current> {
  const books = await listBooks();
  const current = currentOf(books, books[0]?.chapters[0]?.id ?? null);
  if (current === null) {
    throw new Error("The mock shelf has no chapter.");
  }
  return current;
}

describe("Home", () => {
  useMockBackend();

  test("every place shows at once: 3 of conversation, 6 of book, and Settings", async () => {
    show();
    await started();

    const conversation = screen.getByRole("region", { name: "Conversation" });
    const book = screen.getByRole("region", { name: "Book" });
    expect(within(conversation).getAllByRole("button")).toHaveLength(3);
    expect(within(book).getAllByRole("button")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Settings" })).toBeEnabled();
  });

  test("opens on the start button, with the focus line under the topic", async () => {
    show();

    expect(await started()).toBeEnabled();
    const topic = screen.getByTestId("topic");
    const focus = screen.getByText(/what you're working on/u);
    expect(topic.textContent).not.toBe("");
    expect(
      topic.compareDocumentPosition(focus) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("Another topic moves to the next one", async () => {
    const user = userEvent.setup();
    show();
    await started();

    const before = screen.getByTestId("topic").textContent;
    await user.click(screen.getByRole("button", { name: "Another topic" }));
    expect(screen.getByTestId("topic").textContent).not.toBe(before);
  });

  test("the partner steers towards the focus, once", async () => {
    show();
    await started();

    expect(screen.getAllByText(/what you're working on/u)).toHaveLength(1);
  });

  test("today shows one line, the challenge first", async () => {
    show();
    await started();

    const today = screen.getByRole("region", { name: "For today" });
    expect(today).toHaveTextContent("Challenge:");
    expect(today).not.toHaveTextContent("Fancy a change?");
  });

  test("See more unfolds the rest inside Home", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    show({ navigate });
    await started();

    const more = screen.getByRole("button", { name: "See more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);

    const less = screen.getByRole("button", { name: "See less" });
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "For today" })).toHaveTextContent(
      "Fancy a change?",
    );

    await user.click(screen.getByRole("button", { name: "Try it" }));
    expect(navigate).toHaveBeenCalledWith({
      name: "setup",
      preset: {
        topic: screen.getByTestId("topic").textContent,
        mode: "debate",
      },
    });
  });

  test("one line alone has no See more", async () => {
    setMockHome({ rotationSuggestion: null });
    show();
    await started();

    expect(
      screen.getByRole("region", { name: "For today" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "See more" }),
    ).not.toBeInTheDocument();
  });

  test("no lines, no Today and no See more", async () => {
    setMockHome(NO_LINES);
    show();
    await started();

    expect(
      screen.queryByRole("region", { name: "For today" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "See more" }),
    ).not.toBeInTheDocument();
  });

  test("Continue shows only when there is a previous chat", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    const { unmount } = show({ navigate });
    await started();

    await user.click(
      screen.getByRole("button", { name: "Continue the last one" }),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
    const [route] = navigate.mock.calls[0] as [
      { name: string; setup: { continuePrevious: boolean } },
    ];
    expect(route.name).toBe("conversation");
    expect(route.setup.continuePrevious).toBe(true);
    unmount();

    setMockHome({ continueTopic: null });
    show();
    await started();
    expect(
      screen.queryByRole("button", { name: "Continue the last one" }),
    ).not.toBeInTheDocument();
  });

  test("with no books, Book leads to the shelf", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    show({ navigate });
    await started();

    await user.click(screen.getByRole("button", { name: "Vocabulary" }));
    expect(navigate).toHaveBeenCalledWith({ name: "books", bookId: null });
  });

  test("on a chapter, Book leads to it and names it", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    const current = await chapterOnTheShelf();
    show({ navigate, current });
    await started();

    const vocabulary = screen.getByRole("button", { name: /^Vocabulary/u });
    expect(vocabulary).toHaveTextContent(current.chapter.title);
    await user.click(vocabulary);
    expect(navigate).toHaveBeenCalledWith({
      name: "books",
      bookId: current.book.id,
      chapterId: current.chapter.id,
    });
  });

  test("the numbers show only what exists", async () => {
    show({ counts: { drills: 2, recall: 5 } });
    await started();

    const named = (name: RegExp): HTMLElement =>
      screen.getByRole("button", { name });
    expect(named(/^Drills/u)).toHaveTextContent("2 due today");
    expect(named(/^Daily review/u)).toHaveTextContent("5 due today");
    expect(named(/^Progress/u)).toHaveTextContent("4 days in a row");
    expect(screen.getAllByText("4 days in a row")).toHaveLength(2);
  });

  test("nothing due and no streak say nothing on the places", async () => {
    setMockHome({
      streak: { days: 0, freezesLeft: 2, practicedToday: false },
    });
    show({ counts: { drills: 0, recall: 0 } });
    await started();

    for (const name of ["Drills", "Daily review", "Progress", "Vocabulary"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(
      screen.getByText("Your streak starts with today's conversation"),
    ).toBeInTheDocument();
  });

  test("Settings says when an update is waiting", async () => {
    function Waiting({ children }: { children: ReactNode }) {
      const updates = useUpdate();
      const value = useMemo(
        () => ({
          ...updates,
          folded: true,
          state: { kind: "available" as const, version: "9.9.9" },
        }),
        [updates],
      );
      return (
        <UpdateContext.Provider value={value}>
          {children}
        </UpdateContext.Provider>
      );
    }
    render(
      <Waiting>
        <Home navigate={mock()} current={null} counts={{}} />
      </Waiting>,
    );
    await started();

    expect(
      screen.getByRole("button", { name: "Settings, an update is waiting" }),
    ).toBeEnabled();
  });

  test("todayLines keeps challenge, rotation, level", () => {
    const all = {
      activeChallenge: "Use it twice.",
      rotationSuggestion: "debate",
      levelSuggestion: "advanced",
    } as HomeState;

    expect(todayLines(all)).toEqual(["challenge", "rotation", "level"]);
    expect(todayLines({ ...all, activeChallenge: null })).toEqual([
      "rotation",
      "level",
    ]);
    expect(todayLines({ ...all, ...NO_LINES })).toEqual([]);
  });

  test("is in Spanish too", async () => {
    await i18n.changeLanguage("es");
    show();

    expect(await started("Empezar charla")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ver más" })).toBeEnabled();
    expect(
      screen.getByRole("region", { name: "Conversación" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Progreso/u }),
    ).toHaveTextContent("4 días seguidos");
  });

  test("a load that fails says so", async () => {
    setMockHome({
      get profile(): never {
        throw new Error("No home.");
      },
    });
    show();

    expect(await screen.findByRole("alert")).toHaveTextContent("No home.");
  });
});
