import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Settings } from "@shared/domain";
import { useMockBackend } from "@/test/mockBackend";
import { Onboarding } from "./Onboarding";

const SETTINGS: Settings = {
  providerMode: "apiKey",
  model: "claude-sonnet-5-5",
  effort: null,
  claudePath: null,
  sttModel: null,
  strictSpelling: false,
};

describe("Onboarding", () => {
  useMockBackend(false);

  test("the first language is required before moving on", async () => {
    const user = userEvent.setup();
    render(<Onboarding settings={SETTINGS} onDone={mock()} />);

    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Next/u }));
    expect(
      await screen.findByText("Choose your first language to continue."),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("First language"), "fr");
    await user.click(screen.getByRole("button", { name: /Next/u }));
    expect(
      await screen.findByRole("heading", { name: "What should we call you?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });

  test("the connection step waits for a saved key, then the rest can be skipped", async () => {
    const user = userEvent.setup();
    const onDone = mock();
    render(<Onboarding settings={SETTINGS} onDone={onDone} />);

    await user.selectOptions(screen.getByLabelText("First language"), "pt");
    await user.click(screen.getByRole("button", { name: /Next/u }));
    for (let step = 0; step < 3; step += 1) {
      await user.click(screen.getByRole("button", { name: "Skip" }));
    }
    expect(
      await screen.findByRole("heading", { name: "Connect to Claude" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();

    await user.click(screen.getByRole("button", { name: /Next/u }));
    expect(
      await screen.findByText(/Save an API key or find Claude Code/u),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Anthropic API key"), "sk-ant-test");
    await user.click(screen.getByRole("button", { name: "Save key" }));
    expect(
      await screen.findByText("A key is saved in your keychain."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Next/u }));
    await user.click(
      await screen.findByRole("button", { name: "Text only for now" }),
    );
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await user.click(screen.getByRole("button", { name: /Start talking/u }));

    await screen.findByRole("heading", {
      name: "Where would you like to start?",
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    const [profile] = onDone.mock.calls[0] as [
      { nativeLang: string; onboarded: boolean },
    ];
    expect(profile.nativeLang).toBe("pt");
    expect(profile.onboarded).toBe(true);
  });
});
