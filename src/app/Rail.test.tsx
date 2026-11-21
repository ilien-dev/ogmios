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
import { UpdateContext } from "@/features/update/update";
import type { UpdateState, Updates } from "@/features/update/update";
import { i18n } from "@/lib/i18n/i18n";
import { useMockBackend } from "@/test/mockBackend";
import type { Route } from "./routes";
import { Rail } from "./Rail";

const TODAY: Route = { name: "today" };
const BOOK: Route = { name: "book" };
const RUN: Route = { name: "recall", running: "both" };

interface BarProps {
  route: Route;
  navigate?: (route: Route) => void;
  due?: number;
}

function Bar({ route, navigate = mock(), due = 0 }: BarProps): ReactNode {
  return <Rail route={route} navigate={navigate} due={due} />;
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

  test("an activity that takes the whole window takes the rail away through an exit", async () => {
    const { rerender } = render(<Bar route={TODAY} />);
    const rail = screen.getByRole("complementary");
    expect(rail).not.toHaveAttribute("inert");

    rerender(<Bar route={RUN} />);

    expect(rail).toBeInTheDocument();
    expect(rail).toHaveAttribute("inert");
    await waitForElementToBeRemoved(rail);
  });

  test("under reduced motion the rail still goes", async () => {
    const bar = (route: Route): ReactNode => (
      <MotionConfig reducedMotion="always">
        <Bar route={route} />
      </MotionConfig>
    );
    const { rerender } = render(bar(TODAY));
    const rail = screen.getByRole("complementary");

    rerender(bar(RUN));

    await waitForElementToBeRemoved(rail);
  });

  test("a count that goes to nothing leaves through an exit", async () => {
    const { rerender } = render(<Bar route={TODAY} due={3} />);
    const count = within(
      screen.getByRole("button", { name: "Today, 3 back today" }),
    ).getByText("3");

    rerender(<Bar route={TODAY} due={0} />);

    await waitForElementToBeRemoved(count);
    expect(screen.getByRole("button", { name: "Today" })).toBeVisible();
  });
});

describe("Rail", () => {
  useMockBackend();

  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  test("it shows the four places, the same ones on every screen", () => {
    const places = ["Today", "Book", "Chat", "Your English"];
    const { rerender } = render(<Bar route={TODAY} />);

    expect(names(screen.getByRole("navigation", { name: "Places" }))).toEqual(
      places,
    );

    for (const route of [
      BOOK,
      { name: "home" },
      { name: "progress" },
      { name: "settings" },
      { name: "books", bookId: null },
    ] satisfies Route[]) {
      rerender(<Bar route={route} />);
      expect(names(screen.getByRole("navigation", { name: "Places" }))).toEqual(
        places,
      );
    }
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  test("the rail is gone on an activity that takes the whole window", () => {
    const { container, rerender } = render(<Bar route={TODAY} />);
    expect(screen.getByRole("complementary")).toBeVisible();

    rerender(<Bar route={RUN} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("every place is one press away from anywhere", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Bar route={{ name: "settings" }} navigate={navigate} />);

    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(navigate).toHaveBeenLastCalledWith({ name: "today" });
    await user.click(screen.getByRole("button", { name: "Book" }));
    expect(navigate).toHaveBeenLastCalledWith({ name: "book" });
    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(navigate).toHaveBeenLastCalledWith({ name: "home" });
    await user.click(screen.getByRole("button", { name: "Your English" }));
    expect(navigate).toHaveBeenLastCalledWith({ name: "progress" });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(navigate).toHaveBeenLastCalledWith({ name: "settings" });
  });

  test("the place of the screen is marked with aria-current, and only it", () => {
    const { rerender } = render(<Bar route={{ name: "book", tab: "write" }} />);

    expect(screen.getByRole("button", { name: "Book" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Today" })).not.toHaveAttribute(
      "aria-current",
    );

    // The library is under the book, and a setup under the chat.
    rerender(<Bar route={{ name: "books", bookId: null }} />);
    expect(screen.getByRole("button", { name: "Book" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    rerender(<Bar route={{ name: "setup", preset: null }} />);
    expect(screen.getByRole("button", { name: "Chat" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("Settings has its own place and none of the four", () => {
    render(<Bar route={{ name: "settings" }} />);

    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const place of within(
      screen.getByRole("navigation", { name: "Places" }),
    ).getAllByRole("button")) {
      expect(place).not.toHaveAttribute("aria-current");
    }
  });

  test("everything that comes back today is one count, on Today", () => {
    render(<Bar route={BOOK} due={12} />);

    const today = screen.getByRole("button", { name: "Today, 12 back today" });
    expect(today).toHaveTextContent("12");
    expect(within(today).getByText("Today")).toBeVisible();
    for (const name of ["Book", "Chat", "Your English"]) {
      expect(screen.getByRole("button", { name })).not.toHaveTextContent("12");
    }
  });

  test("a dismissed update puts a dot on Settings", () => {
    const available: UpdateState = { kind: "available", version: "9.0.0" };
    const bar = (value: Updates): ReactNode => (
      <UpdateContext.Provider value={value}>
        <Bar route={TODAY} />
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
    render(<Bar route={TODAY} due={2} />);

    expect(names(screen.getByRole("navigation", { name: "Lugares" }))).toEqual([
      "Hoy, 2 vuelven hoy",
      "Libro",
      "Charla",
      "Tu inglés",
    ]);
    expect(screen.getByRole("button", { name: "Ajustes" })).toBeVisible();
  });
});
