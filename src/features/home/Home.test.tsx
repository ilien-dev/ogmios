import { describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HomeState, Settings } from "@shared/domain";
import { SpeechProvider } from "@/features/speech/speech";
import { i18n } from "@/lib/i18n/i18n";
import { getProgress } from "@/lib/ipc";
import { setMockHome } from "@/lib/ipcMockHome";
import { useMockBackend } from "@/test/mockBackend";
import { Home } from "./Home";
import { todayLines } from "./homeLayout";

const NO_LINES = {
  activeChallenge: null,
  rotationSuggestion: null,
  levelSuggestion: null,
};

const SETTINGS: Settings = {
  providerMode: "apiKey",
  model: "claude-sonnet-5-5",
  effort: null,
  claudePath: null,
  sttModel: "parakeet-tdt-0.6b-v2",
  strictSpelling: false,
};

interface Shown {
  navigate?: ReturnType<typeof mock>;
  onSettingsChange?: ReturnType<typeof mock>;
}

function show({ navigate = mock(), onSettingsChange = mock() }: Shown = {}) {
  return render(
    <SpeechProvider>
      <Home
        settings={SETTINGS}
        onSettingsChange={onSettingsChange}
        navigate={navigate}
      />
    </SpeechProvider>,
  );
}

function started(name = "Start conversation"): Promise<HTMLElement> {
  return screen.findByRole("button", { name });
}

describe("Home", () => {
  useMockBackend();

  test("opens on the start button, with the focus line under the topic", async () => {
    show();

    expect(await started()).toBeEnabled();
    const topic = screen.getByTestId("topic");
    const focus = screen.getByText(/what you're working on/u);
    expect(topic.textContent).not.toBe("");
    expect(
      topic.compareDocumentPosition(focus) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("Another topic moves to the next one", async () => {
    const user = userEvent.setup();
    show();
    await started();

    const before = screen.getByTestId("topic").textContent;
    await user.click(screen.getByRole("button", { name: "Another topic" }));
    expect(screen.getByTestId("topic").textContent).not.toBe(before);
  });

  test("the partner steers towards the focus, once", async () => {
    show();
    await started();

    expect(screen.getAllByText(/what you're working on/u)).toHaveLength(1);
  });

  test("today shows one line, the challenge first", async () => {
    show();
    await started();

    const today = screen.getByRole("region", { name: "For today" });
    expect(today).toHaveTextContent("Challenge:");
    expect(today).not.toHaveTextContent("Fancy a change?");
  });

  test("See more unfolds the rest inside Home", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    show({ navigate });
    await started();

    const more = screen.getByRole("button", { name: "See more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);

    const less = screen.getByRole("button", { name: "See less" });
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "For today" })).toHaveTextContent(
      "Fancy a change?",
    );

    await user.click(screen.getByRole("button", { name: "Try it" }));
    expect(navigate).toHaveBeenCalledWith({
      name: "setup",
      preset: {
        topic: screen.getByTestId("topic").textContent,
        mode: "debate",
      },
    });
  });

  test("one line alone has no See more", async () => {
    setMockHome({ rotationSuggestion: null });
    show();
    await started();

    expect(
      screen.getByRole("region", { name: "For today" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "See more" }),
    ).not.toBeInTheDocument();
  });

  test("no lines, no Today and no See more", async () => {
    setMockHome(NO_LINES);
    show();
    await started();

    expect(
      screen.queryByRole("region", { name: "For today" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "See more" }),
    ).not.toBeInTheDocument();
  });

  test("Continue shows only when there is a previous chat", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    const { unmount } = show({ navigate });
    await started();

    await user.click(
      screen.getByRole("button", { name: "Continue the last one" }),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
    const [route] = navigate.mock.calls[0] as [
      { name: string; setup: { continuePrevious: boolean } },
    ];
    expect(route.name).toBe("conversation");
    expect(route.setup.continuePrevious).toBe(true);
    unmount();

    setMockHome({ continueTopic: null });
    show();
    await started();
    expect(
      screen.queryByRole("button", { name: "Continue the last one" }),
    ).not.toBeInTheDocument();
  });

  test("with no streak, Home says it starts today", async () => {
    setMockHome({
      streak: { days: 0, freezesLeft: 2, practicedToday: false },
    });
    show();
    await started();

    expect(
      screen.getByText("Your streak starts with today's conversation"),
    ).toBeInTheDocument();
  });

  test("the streak shows over the partner", async () => {
    show();
    await started();

    expect(screen.getByText("4 days in a row")).toBeInTheDocument();
  });

  test("todayLines keeps challenge, rotation, level", () => {
    const all = {
      activeChallenge: "Use it twice.",
      rotationSuggestion: "debate",
      levelSuggestion: "advanced",
    } as HomeState;

    expect(todayLines(all)).toEqual(["challenge", "rotation", "level"]);
    expect(todayLines({ ...all, activeChallenge: null })).toEqual([
      "rotation",
      "level",
    ]);
    expect(todayLines({ ...all, ...NO_LINES })).toEqual([]);
  });

  test("what comes back today is not here: nothing leads to the daily review", async () => {
    show();
    await started();

    expect(screen.queryByText("Daily review")).toBeNull();
    expect(screen.queryByText(/to review/u)).toBeNull();
    expect(screen.queryByText(/drills? due/u)).toBeNull();
  });

  test("each pattern being polished has its own round of drills", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    show({ navigate });
    await started();

    const pattern = (await getProgress()).patterns.find(
      (each) => each.state !== "mastered",
    );
    if (pattern === undefined) {
      throw new Error("the mock has no pattern to practise");
    }
    await user.click(
      await screen.findByRole("button", {
        name: `Practise 2 min: ${pattern.description}`,
      }),
    );
    expect(navigate).toHaveBeenCalledWith({
      name: "practice",
      patternId: pattern.id,
      format: null,
    });
  });

  test("a round can be asked for in one format", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    show({ navigate });
    await started();

    const formats = screen.getByRole("group", {
      name: "A round in one format",
    });
    expect(within(formats).getAllByRole("button")).toHaveLength(4);
    await user.click(
      within(formats).getByRole("button", { name: "Spot the error" }),
    );
    expect(navigate).toHaveBeenCalledWith({
      name: "practice",
      patternId: null,
      format: "spotError",
    });
  });

  test("the voice is two switches, and turning Speak off is told to the app", async () => {
    const user = userEvent.setup();
    const onSettingsChange = mock();
    show({ onSettingsChange });
    await started();

    const voice = screen.getByRole("region", { name: "Voice" });
    const speak = await within(voice).findByRole("switch", { name: "Speak" });
    expect(speak).toBeChecked();
    expect(
      await within(voice).findByRole("button", { name: /^Turn on Listen/u }),
    ).toBeInTheDocument();

    await user.click(speak);
    await waitFor(() => {
      expect(onSettingsChange).toHaveBeenCalledWith({
        ...SETTINGS,
        sttModel: null,
      });
    });
  });

  test("past conversations are here, each with its feedback", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    show({ navigate });
    await started();

    const past = screen.getByRole("region", { name: "Past conversations" });
    const [first] = await within(past).findAllByRole("button", {
      name: /View feedback/u,
    });
    if (first === undefined) {
      throw new Error("no past conversation has feedback");
    }
    await user.click(first);
    expect(navigate).toHaveBeenCalledWith({
      name: "report",
      sessionId: "s-106",
      report: null,
      origin: "past",
    });
  });

  test("a past conversation is deleted only once it is confirmed", async () => {
    const user = userEvent.setup();
    show();
    await started();

    const [latest] = (await getProgress()).sessions;
    if (latest === undefined) {
      throw new Error("the mock has no past conversation");
    }
    const name = `Delete conversation: ${latest.topic}`;
    const past = screen.getByRole("region", { name: "Past conversations" });
    await user.click(await within(past).findByRole("button", { name }));
    expect(
      within(past).getByText(/^Delete this conversation/u),
    ).toBeInTheDocument();
    await user.click(within(past).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(within(past).queryByRole("button", { name })).toBeNull();
    });
  });

  test("is in Spanish too", async () => {
    await i18n.changeLanguage("es");
    show();

    expect(await started("Empezar charla")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ver más" })).toBeEnabled();
    expect(screen.getByText("4 días seguidos")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Charlas anteriores" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("switch", { name: "Hablar" })).toBeChecked();
  });

  test("a load that fails says so", async () => {
    setMockHome({
      get profile(): never {
        throw new Error("No home.");
      },
    });
    show();

    expect(await screen.findByRole("alert")).toHaveTextContent("No home.");
  });
});
