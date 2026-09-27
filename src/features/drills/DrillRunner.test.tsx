import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { startDrill } from "@/lib/ipc";
import { useMockBackend } from "@/test/mockBackend";
import { DrillRunner } from "./DrillRunner";

describe("DrillRunner", () => {
  useMockBackend();

  test("a miss explains, then adds one similar item to try again", async () => {
    const user = userEvent.setup();
    const drill = await startDrill(null, "transformation");
    render(<DrillRunner drill={drill} onAgain={mock()} onClose={mock()} />);

    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Your answer"),
      "I visited Rome three times",
    );
    await user.click(screen.getByRole("button", { name: "Check" }));

    expect(await screen.findByText("Not quite.")).toBeInTheDocument();
    expect(
      screen.getByText("Expected: I've visited Rome three times."),
    ).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try a similar one" }));
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Your answer"),
      "I sent it two hours ago.",
    );
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Try a similar one" }),
    ).toBeNull();
  });

  test("spot the error: pick the sentence, rewrite it, then see the summary", async () => {
    const user = userEvent.setup();
    const drill = await startDrill(null, "spotError");
    render(<DrillRunner drill={drill} onAgain={mock()} onClose={mock()} />);

    await user.click(
      screen.getByRole("button", { name: "I have seen that film last night." }),
    );
    const field = screen.getByLabelText("Now write it correctly");
    expect(field).toHaveValue("I have seen that film last night.");
    await user.clear(field);
    await user.type(field, "I saw that film last night.");
    await user.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Next/u }));

    await user.click(
      screen.getByRole("button", { name: "I need to do a decision today." }),
    );
    await user.clear(screen.getByLabelText("Now write it correctly"));
    await user.type(
      screen.getByLabelText("Now write it correctly"),
      "I need to make a decision today.",
    );
    await user.click(screen.getByRole("button", { name: "Check" }));
    await screen.findByText("Right.");
    await user.click(screen.getByRole("button", { name: /Next/u }));

    expect(
      screen.getByRole("heading", { name: "Round done" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 of 2 right")).toBeInTheDocument();
  });
});
