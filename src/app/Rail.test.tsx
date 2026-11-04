import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import {
  render,
  screen,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionConfig, MotionGlobalConfig } from "motion/react";
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
import { Rail } from "./Rail";

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
  [{ name: "home" }, "conversation"],
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
  [{ name: "book" }, "chapters"],
  [{ name: "books", bookId: null }, "books"],
  [{ name: "books", bookId: null, known: true }, "books"],
  [{ name: "books", bookId: "b" }, "books"],
  [{ name: "books", bookId: "b", chapterId: "c" }, "chapters"],
  [
    { name: "books", bookId: "b", chapterId: "c", translating: true },
    "translate",
  ],
  [{ name: "recall" }, "recall"],
  [{ name: "structures" }, "structures"],
  [{ name: "listening" }, "listening"],
  [{ name: "settings" }, "settings"],
];

const HOME: Route = { name: "home" };
const RECALL: Route = { name: "recall" };

interface BarProps {
  route: Route;
  navigate?: (route: Route) => void;
  counts?: Partial<Record<Entry, number>>;
  current?: Current | null;
}

function Bar({
  route,
  navigate = mock(),
  counts = {},
  current = null,
}: BarProps): ReactNode {
  return (
    <Rail route={route} navigate={navigate} counts={counts} current={current} />
  );
}

function names(nav: HTMLElement): string[] {
  return within(nav)
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? "");
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

describe("Rail, with real exits", () => {
  const nativeAnimate = Element.prototype.animate;
  useMockBackend();

  // As in `motion.test.tsx`: on motion's own frame loop.
  beforeEach(() => {
    MotionGlobalConfig.skipAnimations = false;
    Reflect.deleteProperty(Element.prototype, "animate");
    spyOn(console, "warn").mockImplementation(() => {});
    // The active place slides from one place to the next, and the place it
    // left stays until it lands: without layout here it would never start.
    spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function place(this: HTMLElement): DOMRect {
        const label = this.parentElement?.getAttribute("aria-label") ?? "";
        return new DOMRect(0, label.length * 10, 40, 40);
      },
    );
  });

  afterEach(() => {
    MotionGlobalConfig.skipAnimations = true;
    Element.prototype.animate = nativeAnimate;
    mock.restore();
  });

  test("moving to Settings takes the places away through an exit", async () => {
    const { rerender } = render(<Bar route={RECALL} />);
    const places = screen.getByRole("navigation", { name: "Book" });
    expect(places).not.toHaveAttribute("inert");

    rerender(<Bar route={{ name: "settings" }} />);

    expect(places).toBeInTheDocument();
    expect(places).toHaveAttribute("inert");
    await waitForElementToBeRemoved(places);
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("under reduced motion the places still go", async () => {
    const bar = (route: Route): ReactNode => (
      <MotionConfig reducedMotion="always">
        <Bar route={route} />
      </MotionConfig>
    );
    const { rerender } = render(bar(RECALL));
    const places = screen.getByRole("navigation", { name: "Book" });

    rerender(bar({ name: "settings" }));

    await waitForElementToBeRemoved(places);
  });

  test("moving across sections swaps the places at once", async () => {
    const { rerender } = render(<Bar route={RECALL} />);
    const book = screen.getByRole("navigation", { name: "Book" });

    rerender(<Bar route={HOME} />);

    expect(book).toHaveAttribute("inert");
    expect(
      screen.getByRole("navigation", { name: "Conversation" }),
    ).not.toHaveAttribute("inert");
    await waitForElementToBeRemoved(book);
  });

  test("a screen that takes the whole window takes the rail away through an exit", async () => {
    const { rerender } = render(<Bar route={RECALL} />);
    const rail = screen.getByRole("complementary");

    rerender(<Bar route={{ name: "recall", running: "both" }} />);

    expect(rail).toHaveAttribute("inert");
    await waitForElementToBeRemoved(rail);
  });
});

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

describe("Rail", () => {
  useMockBackend();

  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  test.each(ROUTES)("the screen %j belongs to %s", (route, entry) => {
    expect(entryOf(route)).toBe(entry);
  });

  test("conversation shows its 3 places and book its 6, chapters first", () => {
    const { rerender } = render(<Bar route={HOME} />);

    expect(
      names(screen.getByRole("navigation", { name: "Conversation" })),
    ).toEqual(["Chat", "Drills", "Progress"]);
    expect(screen.queryByRole("navigation", { name: "Book" })).toBeNull();

    rerender(<Bar route={RECALL} />);

    expect(names(screen.getByRole("navigation", { name: "Book" }))).toEqual([
      "Chapters",
      "Translate",
      "Daily review",
      "Structures",
      "Listening",
      "Books",
    ]);
    expect(
      screen.queryByRole("navigation", { name: "Conversation" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  test("the rail is on Home too, and gone on a screen that takes the whole window", () => {
    const { container, rerender } = render(<Bar route={HOME} />);
    expect(screen.getByRole("complementary")).toBeVisible();

    rerender(<Bar route={{ name: "recall", running: "both" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("both sections are one press away from anywhere, and the one on screen is pressed", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Bar route={RECALL} navigate={navigate} />);
    const sections = screen.getByRole("group", { name: "Sections" });

    expect(
      within(sections).getByRole("button", { name: "Book" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(
      within(sections).getByRole("button", { name: "Conversation" }),
    );
    expect(navigate).toHaveBeenLastCalledWith({ name: "home" });
    await user.click(within(sections).getByRole("button", { name: "Book" }));
    expect(navigate).toHaveBeenLastCalledWith({ name: "book" });
  });

  test("Settings has its own place and no section's", () => {
    render(<Bar route={{ name: "settings" }} />);

    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("navigation")).toBeNull();
    for (const button of within(
      screen.getByRole("group", { name: "Sections" }),
    ).getAllByRole("button")) {
      expect(button).toHaveAttribute("aria-pressed", "false");
    }
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
  });

  test("what is due shows on its place", () => {
    const { rerender } = render(
      <Bar route={HOME} counts={{ drills: 3, recall: 12 }} />,
    );
    expect(
      screen.getByRole("button", { name: "Drills, 3 due today" }),
    ).toHaveTextContent("3");

    rerender(<Bar route={RECALL} counts={{ drills: 3, recall: 12 }} />);
    expect(
      screen.getByRole("button", { name: "Daily review, 12 due today" }),
    ).toHaveTextContent("12");
  });

  test("Chapters opens the book's own screen, and the rest of a chapter's places the current one", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Bar route={RECALL} navigate={navigate} current={CURRENT} />);

    await user.click(screen.getByRole("button", { name: "Chapters" }));
    expect(navigate).toHaveBeenLastCalledWith({ name: "book" });
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

  test("with no chapter, Translate and Listening lead to the shelf", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Bar route={RECALL} navigate={navigate} />);

    for (const name of ["Translate", "Listening"]) {
      await user.click(screen.getByRole("button", { name }));
      expect(navigate).toHaveBeenLastCalledWith({
        name: "books",
        bookId: null,
      });
    }
    await user.click(screen.getByRole("button", { name: "Structures" }));
    expect(navigate).toHaveBeenLastCalledWith({ name: "structures" });
  });

  test("a place keeps its name under its icon", () => {
    render(<Bar route={RECALL} counts={{ recall: 2 }} />);

    const place = screen.getByRole("button", {
      name: "Daily review, 2 due today",
    });
    expect(within(place).getByText("Daily review")).toBeVisible();
  });

  test("Chat goes to the partner on Home", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Bar route={{ name: "progress" }} navigate={navigate} />);

    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(navigate).toHaveBeenCalledWith({ name: "home" });
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
    const { rerender } = render(<Bar route={HOME} />);

    expect(
      screen.getByRole("navigation", { name: "Conversación" }),
    ).toBeVisible();
    expect(screen.getByRole("group", { name: "Secciones" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Charla" })).toBeVisible();

    rerender(<Bar route={RECALL} />);

    expect(screen.getByRole("navigation", { name: "Libro" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Capítulos" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Repaso diario" })).toBeVisible();
  });
});
