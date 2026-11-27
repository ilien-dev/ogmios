import { describe, expect, mock, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedMockReadiness } from "@/lib/ipcMockChapters";
import { recallOptions } from "@/lib/ipc";
import { useMockBackend } from "@/test/mockBackend";
import { RecallChoose } from "./RecallChoose";

/** The chooser over the seeded shelf, and what it was asked to start. */
async function open(): Promise<{
  onStart: ReturnType<typeof mock>;
  due: Record<"hard" | "mid" | "easy" | "all", number>;
}> {
  seedMockReadiness();
  const options = await recallOptions("both");
  const of = (effort: string): number =>
    options.efforts.find((each) => each.effort === effort)?.due ?? 0;
  const onStart = mock();
  render(
    <RecallChoose
      ways="both"
      nativeLang="es"
      onStart={onStart}
      onLeave={mock()}
    />,
  );
  await screen.findByRole("heading", { name: "What will you review today?" });
  return {
    onStart,
    due: {
      hard: of("hard"),
      mid: of("mid"),
      easy: of("easy"),
      all: options.all.words,
    },
  };
}

describe("choosing what to review", () => {
  useMockBackend();

  test("offers the words due by effort, the hardest chosen already", async () => {
    const user = userEvent.setup();
    const { onStart, due } = await open();
    expect(due.hard).toBeGreaterThan(0);
    expect(due.mid).toBeGreaterThan(0);
    expect(due.easy).toBeGreaterThan(0);

    const hard = screen.getByRole("radio", { name: /^Stubborn/u });
    expect(hard).toBeChecked();
    const label = hard.closest("label");
    if (label === null) throw new Error("no label");
    expect(within(label).getByText(String(due.hard))).toBeInTheDocument();
    expect(
      within(label).getByRole("img", { name: "Much effort" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Some effort" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Little effort" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(onStart).toHaveBeenCalledWith({
      ways: "both",
      effort: "hard",
      size: null,
    });
  });

  test("starts the effort and the way the learner picks", async () => {
    const user = userEvent.setup();
    const { onStart, due } = await open();
    await user.click(screen.getByRole("radio", { name: /^Hard-won/u }));
    expect(
      screen.getByRole("group", { name: "How many Hard-won" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", {
        name: new RegExp(`^All ${String(due.mid)} words`, "u"),
      }),
    ).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Spanish → English" }));
    await user.click(await screen.findByRole("button", { name: "Start" }));
    expect(onStart).toHaveBeenCalledWith({
      ways: "production",
      effort: "mid",
      size: null,
    });
  });

  test("says how it decides only when asked", async () => {
    const user = userEvent.setup();
    await open();
    const how = screen.getByRole("button", { name: "How is it decided?" });
    expect(how).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/adds up every miss/u)).toBeNull();
    await user.click(how);
    expect(how).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/adds up every miss/u)).toBeInTheDocument();
  });

  test("everything due at once says first how much that is", async () => {
    const user = userEvent.setup();
    const { onStart, due } = await open();
    const everything = screen.getByRole("button", {
      name: `Review everything due ${String(due.all)}`,
    });

    await user.click(everything);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        new RegExp(`: ${String(due.all)} words, about \\d+ min\\.$`, "u"),
      ),
    ).toBeInTheDocument();
    // Going in parts holds the keyboard, and stays here.
    const parts = within(dialog).getByRole("button", {
      name: "Choose in parts",
    });
    expect(parts).toHaveFocus();
    await user.click(parts);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onStart).not.toHaveBeenCalled();

    await user.click(everything);
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: `Review all ${String(due.all)}`,
      }),
    );
    expect(onStart).toHaveBeenCalledWith({
      ways: "both",
      effort: null,
      size: null,
    });
  });
});
