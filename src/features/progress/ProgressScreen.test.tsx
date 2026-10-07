import { describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
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

  test("leads back to conversation, which it is opened from", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<ProgressScreen navigate={navigate} />);

    await user.click(
      await screen.findByRole("button", { name: "Conversation" }),
    );
    expect(navigate).toHaveBeenCalledWith({ name: "home" });
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
