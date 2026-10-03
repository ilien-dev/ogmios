import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PracticeItem, SessionSetup } from "@shared/domain";
import { SittingItem } from "@/features/books/SittingItem";
import type { Checked } from "@/features/books/SittingItem";
import { Conversation } from "@/features/conversation/Conversation";
import { ReadAloud } from "@/features/settings/ReadAloud";
import { mockSpoken, resetMockSpeech } from "@/lib/ipcMockSpeech";
import { useMockBackend } from "@/test/mockBackend";
import { SpeechProvider } from "./speech";

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

const RECOGNITION: PracticeItem = {
  wordId: "w1",
  direction: "recognition",
  prompt: "tumble",
  context: [
    { text: "She began to ", marked: false },
    { text: "tumble", marked: true },
    { text: " down the hole.", marked: false },
  ],
};

const PRODUCTION: PracticeItem = {
  wordId: "w1",
  direction: "production",
  prompt: "caerse, rodar",
  context: [
    { text: "She began to ", marked: false },
    { text: "", marked: true },
    { text: " down the hole.", marked: false },
  ],
};

function word(item: PracticeItem, verdict: Checked): React.ReactNode {
  return (
    <SpeechProvider>
      <SittingItem
        nativeLang="es"
        item={item}
        check={() => Promise.resolve(verdict)}
        know={null}
        dispute={null}
        notice={null}
        onDispute={null}
        onNext={mock()}
      />
    </SpeechProvider>
  );
}

describe("reading aloud, with the voice downloaded", () => {
  useMockBackend();
  beforeEach(() => {
    resetMockSpeech(true);
  });

  test("the partner's lines are read as they arrive, the learner's never", async () => {
    const user = userEvent.setup();
    render(
      <SpeechProvider>
        <Conversation setup={SETUP} sttModel={null} navigate={mock()} />
      </SpeechProvider>,
    );

    await waitFor(() => {
      expect(mockSpoken()).toHaveLength(1);
    });
    expect(mockSpoken()[0]).toMatch(
      /What's one thing that happened this week/u,
    );

    await user.type(
      screen.getByLabelText("Your answer"),
      "I finished a big report{Enter}",
    );
    await waitFor(
      () => {
        expect(mockSpoken()).toHaveLength(2);
      },
      { timeout: 3000 },
    );
    expect(mockSpoken()[1]).toMatch(/sleeping at the office/u);
    expect(mockSpoken().join(" ")).not.toContain("big report");
  });

  test("a line can be heard again", async () => {
    const user = userEvent.setup();
    render(
      <SpeechProvider>
        <Conversation setup={SETUP} sttModel={null} navigate={mock()} />
      </SpeechProvider>,
    );
    await waitFor(() => {
      expect(mockSpoken()).toHaveLength(1);
    });

    await user.click(await screen.findByRole("button", { name: "Listen" }));
    await waitFor(() => {
      expect(mockSpoken()).toHaveLength(2);
    });
    expect(mockSpoken()[1]).toBe(mockSpoken()[0]);
  });

  test("an English word is read with its sentence as it is shown", async () => {
    render(word(RECOGNITION, { correct: true, accepted: ["rodar"], step: 0 }));

    await waitFor(() => {
      expect(mockSpoken()).toEqual([
        "tumble. She began to tumble down the hole.",
      ]);
    });
  });

  test("asked for in English, the word is read only once the verdict shows it", async () => {
    const user = userEvent.setup();
    render(word(PRODUCTION, { correct: false, accepted: ["tumble"], step: 0 }));

    const field = await screen.findByLabelText("Your translation");
    await screen.findByRole("button", { name: "I don't know" });
    expect(mockSpoken()).toEqual([]);
    expect(screen.queryByRole("button", { name: "Listen" })).toBeNull();

    await user.type(field, "fall{Enter}");
    await waitFor(() => {
      expect(mockSpoken()).toEqual(["tumble"]);
    });
    expect(screen.getByRole("button", { name: "Listen" })).toBeInTheDocument();
  });

  test("turned off, nothing is read until it is asked for", async () => {
    const user = userEvent.setup();
    const settings = render(
      <SpeechProvider>
        <ReadAloud />
      </SpeechProvider>,
    );
    await user.click(
      await screen.findByRole("radio", { name: "Only when I ask" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("radio", { name: "Only when I ask" }),
      ).toBeChecked();
    });
    settings.unmount();

    render(word(RECOGNITION, { correct: true, accepted: ["rodar"], step: 0 }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Listen" })).toHaveLength(2);
    });
    expect(mockSpoken()).toEqual([]);

    const [heading] = screen.getAllByRole("button", { name: "Listen" });
    if (heading === undefined) {
      throw new Error("the word has no way to be heard");
    }
    await user.click(heading);
    await waitFor(() => {
      expect(mockSpoken()).toEqual(["tumble"]);
    });
  });
});

describe("reading aloud, before the voice is downloaded", () => {
  useMockBackend();

  test("nothing is read, and where it would be the voice is offered", async () => {
    const user = userEvent.setup();
    render(word(RECOGNITION, { correct: true, accepted: ["rodar"], step: 0 }));

    const [offer] = await screen.findAllByRole("button", {
      name: /Download the voice to hear this/u,
    });
    expect(screen.queryByRole("button", { name: "Listen" })).toBeNull();
    expect(mockSpoken()).toEqual([]);

    if (offer === undefined) {
      throw new Error("the voice is not offered");
    }
    await user.click(offer);
    // Once it is here, what is on the screen is read without another press.
    await waitFor(() => {
      expect(mockSpoken()).toEqual([
        "tumble. She began to tumble down the hole.",
      ]);
    });
    expect(screen.getAllByRole("button", { name: "Listen" })).toHaveLength(2);
  });

  test("the voice is one download, and then it has a voice to pick", async () => {
    const user = userEvent.setup();
    render(
      <SpeechProvider>
        <ReadAloud />
      </SpeechProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /Download/u }));
    expect(await screen.findByRole("radio", { name: /Heart/u })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: /George/u }));
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /George/u })).toBeChecked();
    });
    expect(screen.getByRole("radio", { name: "Read it aloud" })).toBeChecked();
  });
});
