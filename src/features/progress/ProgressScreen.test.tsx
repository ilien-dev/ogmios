import { describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { seedMockReadiness } from "@/lib/ipcMockChapters";
import { useMockBackend } from "@/test/mockBackend";
import { ProgressScreen } from "./ProgressScreen";

/** The words listed, each with what stands beside it. */
function listed(): string[] {
  return screen
    .getAllByRole("term")
    .map((word) => word.parentElement?.textContent ?? "");
}

describe("ProgressScreen", () => {
  useMockBackend();

  test("leaves the way out to the menu", async () => {
    render(<ProgressScreen navigate={mock()} />);

    await screen.findByRole("heading", { name: "Words you learned" });
    expect(screen.queryByRole("button", { name: "Conversation" })).toBeNull();
  });

  test("the words asked for in conversations are listed", async () => {
    render(<ProgressScreen navigate={mock()} />);

    expect(
      await screen.findByRole("heading", { name: "Words you learned" }),
    ).toBeInTheDocument();
    expect(listed()).toHaveLength(6);
    expect(listed()[0]).toBe("lead timeplazo de entrega");
    expect(screen.queryByRole("button", { name: /^Show all/u })).toBeNull();
  });

  test("book words finished in practice are listed with their translation", async () => {
    seedMockReadiness();
    const user = userEvent.setup();
    render(<ProgressScreen navigate={mock()} />);

    await screen.findByRole("heading", { name: "Words you learned" });
    // The latest first, and only a few until the rest is asked for.
    expect(listed()).toHaveLength(12);
    expect(listed()).toContain("waistcoatchaleco");
    expect(listed()).toContain("peepasomarse");
    expect(listed()).not.toContain("to juggle");

    await user.click(screen.getByRole("button", { name: "Show all 13 words" }));
    expect(listed()).toHaveLength(13);
    expect(listed()).toContain("to juggle");
    // A word finished in two chapters is one word.
    expect(listed().filter((word) => word === "waistcoatchaleco")).toHaveLength(
      1,
    );
    expect(screen.queryByRole("button", { name: /^Show all/u })).toBeNull();
  });

  test("the focus stands over the staircase until another pattern is picked", async () => {
    const user = userEvent.setup();
    render(<ProgressScreen navigate={mock()} />);
    const scene = await screen.findByRole("region", { name: "Patterns" });
    const focus = "Present perfect vs past simple with finished time";
    const other = "Third-person -s in the present simple";

    expect(within(scene).getByText(focus)).toBeInTheDocument();
    expect(within(scene).getByText("In focus · 2 steps to go")).toBeVisible();

    await user.click(screen.getByRole("button", { name: new RegExp(other) }));
    expect(
      screen.getByRole("button", { name: new RegExp(other) }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(within(scene).queryAllByText(focus)).toHaveLength(0);
    });
    expect(within(scene).getByText(other)).toBeInTheDocument();
  });

  test("a conversation is deleted only once confirmed", async () => {
    const user = userEvent.setup();
    render(<ProgressScreen navigate={mock()} />);
    const remove = {
      name: "Delete conversation: Una pequeña victoria en el trabajo",
    };

    await user.click(await screen.findByRole("button", remove));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByText("Una pequeña victoria en el trabajo"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", remove));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    // Counted on purpose: a failed match on an element prints the whole page.
    await waitFor(() => {
      expect(screen.queryAllByRole("button", remove)).toHaveLength(0);
    });
    expect(
      screen.queryAllByText("Una pequeña victoria en el trabajo"),
    ).toHaveLength(0);
    expect(screen.getByText("Un viaje que salió mal")).toBeInTheDocument();
  });
});
