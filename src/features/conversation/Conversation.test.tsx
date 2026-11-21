import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionSetup } from "@shared/domain";
import { SpeechProvider } from "@/features/speech/speech";
import { ttsStatus } from "@/lib/ipc";
import { resetMockSpeech } from "@/lib/ipcMockSpeech";
import { useMockBackend } from "@/test/mockBackend";
import { Conversation } from "./Conversation";

const SETUP: SessionSetup = {
  topic: "A small win at work",
  level: "intermediate",
  mode: "casual",
  personality: "curiousFriend",
  focusMode: "free",
  continuePrevious: false,
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
    expect(
      await screen.findByText("Ogmios: Try 2–3 sentences"),
    ).toBeInTheDocument();

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
    await screen.findByText("Ogmios: Try 2–3 sentences");

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

  test("with Speak off, the microphone stays as the way to turn it on", async () => {
    render(<Conversation setup={SETUP} sttModel={null} navigate={mock()} />);
    await screen.findByText("Ogmios: Try 2–3 sentences");

    expect(
      screen.getByRole("button", { name: "Turn on Speak" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Microphone/u })).toBeNull();
    expect(screen.getByLabelText("Your answer")).toHaveAttribute(
      "placeholder",
      "Type here",
    );
  });

  test("under the app's voice, its switch decides and Listen shows as it stands", async () => {
    const user = userEvent.setup();
    resetMockSpeech(true);
    render(
      <SpeechProvider>
        <Conversation setup={SETUP} sttModel={null} navigate={mock()} />
      </SpeechProvider>,
    );
    await screen.findByText("Ogmios: Try 2–3 sentences");

    // The learner's model is picked: the stale setting does not hide the mic.
    expect(
      await screen.findByRole("button", { name: /Microphone/u }),
    ).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Listen: on" }));
    expect(
      await screen.findByRole("button", { name: "Listen: off" }),
    ).toBeInTheDocument();
    expect((await ttsStatus()).enabled).toBe(false);
  });

  test("the orb says it is listening while recording", async () => {
    const user = userEvent.setup();
    render(
      <Conversation
        setup={SETUP}
        sttModel="parakeet-tdt-0.6b-v2"
        navigate={mock()}
      />,
    );
    await screen.findByText("Ogmios: Try 2–3 sentences");
    expect(screen.getByText("In conversation")).toBeInTheDocument();

    const mic = screen.getByRole("button", { name: /Microphone/u });
    mic.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Listening…")).toBeInTheDocument();
    expect(screen.queryByText("In conversation")).toBeNull();
  });

  test("the screen shows spoken minutes and the mood note", async () => {
    render(<Conversation setup={SETUP} sttModel={null} navigate={mock()} />);
    await screen.findByText("Ogmios: Try 2–3 sentences");

    expect(screen.getByText("0 of 10 min spoken")).toBeInTheDocument();
    expect(
      screen.getByText(
        /Ogmios: (Keep going|No corrections now|Rough is fine|Say it your way)/u,
      ),
    ).toBeInTheDocument();
  });

  test("nothing on the chat screen corrects", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Conversation setup={SETUP} sttModel={null} navigate={mock()} />,
    );
    await screen.findByText("Ogmios: Try 2–3 sentences");
    await user.type(
      screen.getByLabelText("Your answer"),
      "I have went there yesterday{Enter}",
    );
    await screen.findByText(/sleeping at the office/u, undefined, {
      timeout: 3000,
    });

    expect(container.querySelector("mark")).toBeNull();
    expect(screen.queryByText("Can you fix it?")).toBeNull();
    expect(screen.queryByText(/Better/u)).toBeNull();
  });
});
