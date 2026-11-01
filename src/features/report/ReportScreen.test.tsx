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
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionGlobalConfig } from "motion/react";
import type { Report } from "@shared/domain";
import { getReport } from "@/lib/ipc";
import { useMockBackend } from "@/test/mockBackend";
import { ReportScreen } from "./ReportScreen";

async function report(): Promise<Report> {
  const found = await getReport("s-106");
  if (found === null) {
    throw new Error("The mock has no report.");
  }
  return found;
}

describe("ReportScreen", () => {
  useMockBackend();

  test("one card at a time, with arrow keys and a closing card", async () => {
    const user = userEvent.setup();
    render(
      <ReportScreen
        sessionId="s-106"
        initial={await report()}
        origin="session"
        navigate={mock()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "What went well" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 of 9")).toBeInTheDocument();

    await user.keyboard("{ArrowRight}");
    expect(
      screen.getByRole("heading", { name: "One thing to work on" }),
    ).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    expect(
      screen.getByRole("heading", { name: "What went well" }),
    ).toBeInTheDocument();

    for (let step = 0; step < 8; step += 1) {
      await user.click(screen.getByRole("button", { name: /Next/u }));
    }
    expect(
      screen.getByRole("heading", { name: "That's it for today" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Next/u })).toBeNull();
  });

  test("the focus correction asks first, hints after a miss, then confirms a fix", async () => {
    const user = userEvent.setup();
    render(
      <ReportScreen
        sessionId="s-106"
        initial={await report()}
        origin="session"
        navigate={mock()}
      />,
    );
    await user.keyboard("{ArrowRight}");

    expect(screen.queryByText("Better")).toBeNull();
    const field = screen.getByRole("textbox", { name: "Can you fix it?" });
    expect(field).toHaveValue(
      "I have finished the report yesterday, so my boss was happy.",
    );

    await user.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText(/Hint:/u)).toBeInTheDocument();

    await user.clear(field);
    await user.type(
      field,
      "I finished the report yesterday, so my boss was happy.",
    );
    await user.click(screen.getByRole("button", { name: "Check" }));
    // Fixed, but only after the hint: it is not the clean fix.
    expect(
      await screen.findByText("Fixed, with the hint."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "I finished the report yesterday, so my boss was happy.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "I disagree" }));
    expect(
      await screen.findByText("Noted. This one won't count."),
    ).toBeInTheDocument();
  });

  test("a lexical minor shows the better version straight away", async () => {
    const user = userEvent.setup();
    render(
      <ReportScreen
        sessionId="s-106"
        initial={await report()}
        origin="session"
        navigate={mock()}
      />,
    );
    await user.keyboard("{ArrowRight}{ArrowRight}");

    expect(
      screen.getByRole("heading", { name: "2 small things" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Honestly, I made a big effort to finish on time."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("textbox", { name: "Can you fix it?" }),
    ).toHaveLength(1);
  });

  test("the native rewrite has its own card, with what changed and why", async () => {
    const user = userEvent.setup();
    render(
      <ReportScreen
        sessionId="s-106"
        initial={await report()}
        origin="session"
        navigate={mock()}
      />,
    );
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(
      screen.getByRole("heading", { name: "You could have said" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Yours")).toBeNull();

    await user.keyboard("{ArrowRight}");
    expect(
      screen.getByRole("heading", {
        name: "How a native speaker might put it",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("5 of 9")).toBeInTheDocument();
    expect(screen.getAllByText("juggling")).toHaveLength(2);
    expect(
      screen.getByText(/atender varias cosas a la vez/u),
    ).toBeInTheDocument();
  });

  test("a report without a focus card still steps through and offers practice", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    const full = await report();
    const cards = full.cards.filter(
      (card) => card.type !== "correction" || card.role === "minor",
    );
    render(
      <ReportScreen
        sessionId="s-106"
        initial={{ ...full, cards }}
        origin="session"
        navigate={navigate}
      />,
    );
    expect(screen.getByText("1 of 8")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(
      screen.getByRole("heading", { name: "2 small things" }),
    ).toBeInTheDocument();
    for (let step = 0; step < 6; step += 1) {
      await user.keyboard("{ArrowRight}");
    }
    await user.click(screen.getByRole("button", { name: /Practise this/u }));
    expect(navigate).toHaveBeenCalledWith({
      name: "practice",
      patternId: "p-make-do",
      format: null,
      autostart: true,
    });
  });

  test("the closing card offers practice on the focus pattern", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(
      <ReportScreen
        sessionId="s-106"
        initial={await report()}
        origin="session"
        navigate={navigate}
      />,
    );
    for (let step = 0; step < 8; step += 1) {
      await user.keyboard("{ArrowRight}");
    }
    await user.click(screen.getByRole("button", { name: /Practise this/u }));
    expect(navigate).toHaveBeenCalledWith({
      name: "practice",
      patternId: "p-present-perfect",
      format: null,
      autostart: true,
    });
  });

  test("the report has one card per step with its dots", async () => {
    render(
      <ReportScreen
        sessionId="s-106"
        initial={await report()}
        origin="session"
        navigate={mock()}
      />,
    );
    const dots = screen.getByRole("img", { name: "1 of 9" });
    expect(dots.children).toHaveLength(9);
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
  });

  test("Back and Next move between cards", async () => {
    const user = userEvent.setup();
    render(
      <ReportScreen
        sessionId="s-106"
        initial={await report()}
        origin="session"
        navigate={mock()}
      />,
    );
    const back = screen.getByRole("button", { name: "Previous card" });
    expect(back).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Next/u }));
    expect(
      screen.getByRole("heading", { name: "One thing to work on" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "2 of 9" })).toBeInTheDocument();

    await user.click(back);
    expect(
      screen.getByRole("heading", { name: "What went well" }),
    ).toBeInTheDocument();
    expect(back).toBeDisabled();
  });

  test("a report never shows more than one focus and two minors", async () => {
    const user = userEvent.setup();
    const full = await report();
    const corrections = full.cards.filter((card) => card.type === "correction");
    const extra = corrections.flatMap((card) => [
      card,
      { ...card, itemId: `${card.itemId}-again` },
    ]);
    const others = full.cards.filter((card) => card.type !== "correction");
    render(
      <ReportScreen
        sessionId="s-106"
        initial={{ ...full, cards: [...extra, ...others] }}
        origin="session"
        navigate={mock()}
      />,
    );
    let focus = 0;
    let minors = 0;
    for (let step = 0; step < 12; step += 1) {
      focus += screen.queryAllByRole("heading", {
        name: "One thing to work on",
      }).length;
      if (screen.queryByRole("heading", { name: /small things?$/u }) !== null) {
        minors = screen.getAllByText("What you said").length;
      }
      await user.keyboard("{ArrowRight}");
    }
    expect(focus).toBe(1);
    expect(minors).toBeLessThanOrEqual(2);
    expect(minors).toBeGreaterThan(0);
  });
});

describe("ReportScreen, with real exits", () => {
  const nativeAnimate = Element.prototype.animate;
  useMockBackend();

  // As in `motion.test.tsx`: on motion's own frame loop.
  beforeEach(() => {
    MotionGlobalConfig.skipAnimations = false;
    Reflect.deleteProperty(Element.prototype, "animate");
    spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    MotionGlobalConfig.skipAnimations = true;
    Element.prototype.animate = nativeAnimate;
    mock.restore();
  });

  test("the card that goes stays on screen, out of reach, until it has left", async () => {
    const user = userEvent.setup();
    render(
      <ReportScreen
        sessionId="s-106"
        initial={await report()}
        origin="session"
        navigate={mock()}
      />,
    );
    const first = screen.getByRole("heading", { name: "What went well" });
    const card = first.closest("section") as HTMLElement;

    await user.keyboard("{ArrowRight}");

    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute("inert");
    // The next card is already there, and the keys work during the exit.
    expect(
      screen.getByRole("heading", { name: "One thing to work on" }),
    ).toBeInTheDocument();
    await waitForElementToBeRemoved(card);
  });
});
