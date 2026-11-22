import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { Settings } from "@shared/domain";
import { i18n } from "@/lib/i18n/i18n";
import { getSettings, sttStatus, ttsStatus } from "@/lib/ipc";
import { setMockLatency } from "@/lib/ipcMock";
import { resetMockSpeech } from "@/lib/ipcMockSpeech";
import { useMockBackend } from "@/test/mockBackend";
import { ListenToggle, VoiceRows } from "./VoiceCard";
import { SpeechProvider } from "./speech";

const DRAFT: Settings = {
  providerMode: "apiKey",
  model: "claude-sonnet-5-5",
  effort: null,
  claudePath: null,
  sttModel: null,
  strictSpelling: false,
};

function rows(
  settings: Settings,
  onSettingsChange: (settings: Settings) => void = mock(),
): ReactNode {
  return (
    <SpeechProvider>
      <VoiceRows settings={settings} onSettingsChange={onSettingsChange} />
    </SpeechProvider>
  );
}

describe("the voice, on a first launch", () => {
  useMockBackend(false);

  test("turning Speak on downloads a model and uses it, in one press", async () => {
    const user = userEvent.setup();
    const onSettingsChange = mock();
    render(rows(DRAFT, onSettingsChange));

    await user.click(
      await screen.findByRole("button", { name: /^Turn on Speak/u }),
    );

    const speak = await screen.findByRole("switch", { name: "Speak" });
    expect(speak).toBeChecked();
    expect(screen.queryByRole("button", { name: "Use this model" })).toBeNull();
    const { selected, models } = await sttStatus();
    expect(selected).toBe(models[0]?.id ?? null);
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DRAFT,
      sttModel: selected,
    });
  });

  test("turning Listen on downloads the voice, and it reads by itself", async () => {
    const user = userEvent.setup();
    render(rows(DRAFT));

    await user.click(
      await screen.findByRole("button", { name: /^Turn on Listen/u }),
    );

    expect(await screen.findByRole("switch", { name: "Listen" })).toBeChecked();
    const voice = await ttsStatus();
    expect(voice.downloaded).toBe(true);
    expect(voice.enabled).toBe(true);
  });

  test("the two are named in Spanish too", async () => {
    await i18n.changeLanguage("es");
    render(rows(DRAFT));

    expect(
      await screen.findByRole("button", { name: /^Activar Hablar/u }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /^Activar Escuchar/u }),
    ).toBeInTheDocument();
  });
});

describe("the voice, once it is on disk", () => {
  useMockBackend();
  beforeEach(() => {
    resetMockSpeech(true);
  });

  test("Speak turns off and on again without another download", async () => {
    // Each step waits on the mock as on a slow machine, so that the waits
    // below are held to what the switch does, not to how fast it is.
    setMockLatency(1);
    const user = userEvent.setup();
    const onSettingsChange = mock();
    const settings = await getSettings();
    render(rows(settings, onSettingsChange));

    const speak = await screen.findByRole("switch", { name: "Speak" });
    expect(speak).toBeChecked();

    // A wait asks by role and state, never with a matcher on the element:
    // each miss of one prints the whole element, which takes long enough to
    // hold back the steps it waits for.
    await user.click(speak);
    await screen.findByRole("switch", { name: "Speak", checked: false });
    // It takes no press while the change is being saved.
    await waitFor(() => {
      if (speak.hasAttribute("disabled")) {
        throw new Error("Speak is still being saved.");
      }
    });
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...settings,
      sttModel: null,
    });
    expect((await getSettings()).sttModel).toBeNull();

    await user.click(speak);
    await screen.findByRole("switch", { name: "Speak", checked: true });
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...settings,
      sttModel: settings.sttModel,
    });
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  test("Listen is a switch: off, nothing is read by itself", async () => {
    const user = userEvent.setup();
    render(rows(await getSettings()));

    const listen = await screen.findByRole("switch", { name: "Listen" });
    expect(listen).toBeChecked();
    await user.click(listen);

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Listen" })).not.toBeChecked();
    });
    expect((await ttsStatus()).enabled).toBe(false);
  });

  test("the small control says whether it reads, and turns it off", async () => {
    const user = userEvent.setup();
    render(
      <SpeechProvider>
        <ListenToggle />
      </SpeechProvider>,
    );

    const toggle = await screen.findByRole("button", { name: "Listen: on" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await user.click(toggle);

    expect(
      await screen.findByRole("button", { name: "Listen: off" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect((await ttsStatus()).enabled).toBe(false);
  });
});
