import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionSetup } from "@shared/domain";
import { useMockBackend } from "@/test/mockBackend";
import { Conversation } from "./Conversation";

const SETUP: SessionSetup = {
  topic: "A small win at work",
  level: "intermediate",
  mode: "casual",
  personality: "curiousFriend",
  focusMode: "free",
  targetMinutes: 10,
  material: null,
};

describe("Conversation", () => {
  useMockBackend();

  test("streams the opening, sends a turn and streams the reply", async () => {
    const user = userEvent.setup();
    render(<Conversation setup={SETUP} sttModel={null} navigate={mock()} />);

    expect(
      await screen.findByText(/What's one thing that happened this week/u),
    ).toBeInTheDocument();
    expect(await screen.findByText("Try 2–3 sentences")).toBeInTheDocument();

    const box = screen.getByLabelText("Your answer");
    await user.type(box, "I finished a big report");
    expect(
      screen.getByRole("meter", { name: "Words this turn" }),
    ).toHaveAttribute("aria-valuenow", "5");

    await user.keyboard("{Enter}");
    expect(
      await screen.findByText("I finished a big report"),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/sleeping at the office/u, undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument();
    expect(box).toHaveValue("");
  });

  test("a recording lands in the composer as editable text", async () => {
    const user = userEvent.setup();
    render(
      <Conversation
        setup={SETUP}
        sttModel="parakeet-tdt-0.6b-v2"
        navigate={mock()}
      />,
    );
    await screen.findByText("Try 2–3 sentences");

    const mic = screen.getByRole("button", { name: /Microphone/u });
    mic.focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("button", { name: "Stop recording" }),
    ).toBeInTheDocument();
    // The words appear while the learner is still speaking.
    expect(await screen.findByDisplayValue(/^Well, this/u)).toBeInTheDocument();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByText(
        "This is what was heard. Change anything, then press Enter.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Your answer")).toHaveValue(
      "Well, this week I have finished a big report for the logistics team and my boss was really happy with it.",
    );
  });
});
