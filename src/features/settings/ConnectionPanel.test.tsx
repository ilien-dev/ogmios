import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Settings } from "@shared/domain";
import { getSettings, saveSettings } from "@/lib/ipc";
import { useMockBackend } from "@/test/mockBackend";
import { ConnectionPanel } from "./ConnectionPanel";

function Harness({ initial }: { initial: Settings }): ReactNode {
  const [settings, setSettings] = useState(initial);
  const [hasKey, setHasKey] = useState(false);
  return (
    <ConnectionPanel
      settings={settings}
      hasKey={hasKey}
      onSettingsChange={setSettings}
      onHasKeyChange={setHasKey}
    />
  );
}

const CLAUDE_CODE: Settings = {
  providerMode: "claudeCode",
  model: "claude-sonnet-5",
  effort: null,
  claudePath: "/home/you/.local/bin/claude",
  sttModel: null,
};

describe("ConnectionPanel", () => {
  useMockBackend();

  test("offers Claude Code's own models and moves an old id to its family", async () => {
    await saveSettings(CLAUDE_CODE);
    render(<Harness initial={CLAUDE_CODE} />);

    const model = await screen.findByRole("option", {
      name: "Sonnet — Sonnet 5.5 · Efficient for routine tasks",
    });
    await waitFor(() => {
      expect((model as HTMLOptionElement).selected).toBe(true);
    });
    expect(screen.getByRole("option", { name: /^Fable/u })).toBeInTheDocument();
    expect((await getSettings()).model).toBe("sonnet");
  });

  test("the effort is the learner's choice, among what the model takes", async () => {
    const user = userEvent.setup();
    await saveSettings(CLAUDE_CODE);
    render(<Harness initial={CLAUDE_CODE} />);

    const effort = await screen.findByLabelText("Thinking effort");
    await user.selectOptions(effort, "high");
    expect((await getSettings()).effort).toBe("high");

    await user.selectOptions(screen.getByLabelText("Model"), "haiku");
    await waitFor(() => {
      expect(screen.queryByLabelText("Thinking effort")).toBeNull();
    });
    expect(await getSettings()).toMatchObject({ model: "haiku", effort: null });
  });

  test("asks to connect before listing models", () => {
    render(<Harness initial={{ ...CLAUDE_CODE, claudePath: null }} />);

    expect(
      screen.getByText("Connect first to see the models you can use."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toBeDisabled();
  });
});
