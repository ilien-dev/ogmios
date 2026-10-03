import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
});
