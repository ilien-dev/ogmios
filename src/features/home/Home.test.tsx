import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HomeState } from "@shared/domain";
import { i18n } from "@/lib/i18n/i18n";
import { setMockHome } from "@/lib/ipcMockHome";
import { useMockBackend } from "@/test/mockBackend";
import { Home } from "./Home";
import { todayLines } from "./homeLayout";

const NO_LINES = {
  activeChallenge: null,
  rotationSuggestion: null,
  levelSuggestion: null,
};

interface Shown {
  navigate?: ReturnType<typeof mock>;
}

function show({ navigate = mock() }: Shown = {}) {
  return render(<Home navigate={navigate} />);
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

  test("is in Spanish too", async () => {
    await i18n.changeLanguage("es");
    show();

    expect(await started("Empezar charla")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Ver más" })).toBeEnabled();
    expect(screen.getByText("4 días seguidos")).toBeInTheDocument();
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
