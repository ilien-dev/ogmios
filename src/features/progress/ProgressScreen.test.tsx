import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MineTab, Route } from "@/app/routes";
import { i18n } from "@/lib/i18n/i18n";
import { seedMockReadiness } from "@/lib/ipcMockChapters";
import { setMockWordKnown } from "@/lib/ipcMockWords";
import { useMockBackend } from "@/test/mockBackend";
import { ProgressScreen } from "./ProgressScreen";

/** The words listed, each with what stands beside it. */
function listed(): string[] {
  return screen
    .getAllByRole("term")
    .map((word) => word.parentElement?.textContent ?? "");
}

/** The screen on one of its tabs, with the moves it asks for kept. */
function open(tab: MineTab): ReturnType<typeof mock> {
  const navigate = mock();
  render(<ProgressScreen tab={tab} nativeLang="es" navigate={navigate} />);
  return navigate;
}

/** The screen as the app holds it: a tile changes the tab of its route. */
function Place(): ReactNode {
  const [route, setRoute] = useState<Route>({ name: "progress" });
  if (route.name !== "progress") {
    return <p>{`Left for ${route.name}`}</p>;
  }
  return (
    <ProgressScreen
      tab={route.tab ?? "words"}
      nativeLang="es"
      navigate={setRoute}
    />
  );
}

describe("what the learner has gathered", () => {
  useMockBackend();

  test("four tiles say what there is, and the one on the screen is pressed", async () => {
    const navigate = open("words");

    const tiles = within(
      await screen.findByRole("group", { name: "What you have gathered" }),
    ).getAllByRole("button");
    expect(tiles.map((tile) => tile.textContent.replace(/\d+$/u, ""))).toEqual([
      "Words",
      "Patterns",
      "Structures",
      "Min this week",
    ]);
    expect(tiles.map((tile) => tile.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ]);
    await waitFor(() => {
      expect(tiles[2]).toHaveTextContent(/36$/u);
    });

    await userEvent.setup().click(tiles[2] as HTMLElement);
    expect(navigate).toHaveBeenCalledWith({
      name: "progress",
      tab: "structures",
    });
  });

  test("a tile swaps the board and the scene, and the screen stays", async () => {
    const user = userEvent.setup();
    render(<Place />);

    await screen.findByRole("region", { name: "Your words by strength" });
    await user.click(screen.getByRole("button", { name: /^Patterns/u }));
    await screen.findByRole("region", { name: "Patterns" });
    await waitFor(() => {
      expect(
        screen.queryAllByRole("region", { name: "Your words by strength" }),
      ).toHaveLength(0);
    });
    expect(screen.getByRole("button", { name: /^Patterns/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: /^Min this week/u }));
    await screen.findByRole("region", { name: "Time spoken" });
  });
});

describe("the words", () => {
  useMockBackend();

  test("the words asked for in conversations are listed in their sheet", async () => {
    const user = userEvent.setup();
    open("words");

    await screen.findByRole("heading", { name: "The latest you learned" });
    await user.click(screen.getByRole("button", { name: "See your 6 words" }));
    const sheet = await screen.findByRole("dialog", {
      name: "Words you learned",
    });
    expect(within(sheet).getAllByRole("term")).toHaveLength(6);
    expect(listed()[0]).toBe("lead timeplazo de entrega");
    expect(screen.queryByRole("button", { name: /^Show all/u })).toBeNull();
  });

  test("book words finished in practice are listed with their translation", async () => {
    seedMockReadiness();
    const user = userEvent.setup();
    open("words");

    await user.click(
      await screen.findByRole("button", { name: "See your 13 words" }),
    );
    await screen.findByRole("dialog", { name: "Words you learned" });
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

  test("the towers of the daily review name their latest words", async () => {
    seedMockReadiness();
    open("words");

    const scene = await screen.findByRole("region", {
      name: "Your words by strength",
    });
    expect(
      await within(scene).findByText("Each floor is 4 words."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(within(scene).getByText(/waistcoat/u)).toBeInTheDocument();
    });
  });

  test("the daily review is named as everywhere, and a run starts from here", async () => {
    seedMockReadiness();
    const user = userEvent.setup();
    const navigate = open("words");

    await screen.findByRole("heading", { name: "Daily review" });
    const waiting = await screen.findByText(/^\d+ words are waiting today$/u);
    const due = Number.parseInt(waiting.textContent, 10);
    // The tile counts every word the review holds.
    expect(
      screen.getByRole("button", { name: /^Words\s?\d+$/u }),
    ).toHaveTextContent(new RegExp(`${String(due)}$`, "u"));

    await user.click(screen.getByRole("radio", { name: /^English → / }));
    const start = screen.getByRole("button", { name: "Start" });
    await waitFor(() => {
      expect(start).toBeEnabled();
    });
    await user.click(start);
    expect(navigate).toHaveBeenCalledWith({
      name: "recall",
      running: "recognition",
    });
  });

  test("every known word is listed, and one can be taken back", async () => {
    seedMockReadiness();
    setMockWordKnown("marmalade", true);
    // Known from a book that is gone: nothing is left to translate it.
    setMockWordKnown("quay", true);
    const user = userEvent.setup();
    open("words");

    const opener = await screen.findByRole("button", {
      name: /^Words you already know/u,
    });
    await waitFor(() => {
      expect(opener).toHaveTextContent(/3$/u);
    });
    await user.click(opener);
    const known = await screen.findByRole("region", {
      name: "Words you already know",
    });
    const rows = (): Array<string | null> =>
      within(known)
        .getAllByRole("listitem")
        .map((row) => row.textContent);
    await within(known).findByText("3 words you already know");
    // The one marked last comes first.
    expect(rows()).toEqual([
      "quayUndo",
      "marmalademermeladaUndo",
      "hedgesetoUndo",
    ]);

    await user.click(screen.getByRole("button", { name: "Undo: quay" }));
    await within(known).findByText("2 words you already know");
    await i18n.changeLanguage("es");
    expect(
      screen.getByRole("heading", { name: "Palabras que ya sabes" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Deshacer: marmalade" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Deshacer: hedge" }),
    );
    expect(
      await within(known).findByText(
        "Aún no has marcado ninguna palabra como sabida.",
      ),
    ).toBeInTheDocument();
  });

  test("with no word marked as known it says so", async () => {
    const user = userEvent.setup();
    open("words");
    await user.click(
      await screen.findByRole("button", { name: /^Words you already know/u }),
    );

    expect(
      await screen.findByText("You haven't marked any word as known yet."),
    ).toBeInTheDocument();
  });
});

describe("the patterns", () => {
  useMockBackend();

  test("the focus stands over the staircase until another pattern is picked", async () => {
    const user = userEvent.setup();
    open("patterns");
    const scene = await screen.findByRole("region", { name: "Patterns" });
    const focus = "Present perfect vs past simple with finished time";
    const other = "Third-person -s in the present simple";

    expect(within(scene).getByText(focus)).toBeInTheDocument();
    expect(within(scene).getByText("In focus · 2 steps to go")).toBeVisible();

    await user.click(screen.getByRole("button", { name: new RegExp(other) }));
    expect(
      screen.getByRole("button", { name: new RegExp(other) }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(within(scene).queryAllByText(focus)).toHaveLength(0);
    });
    expect(within(scene).getByText(other)).toBeInTheDocument();
  });

  test("the conversations are not listed here any more", async () => {
    open("patterns");

    await screen.findByRole("region", { name: "Patterns" });
    expect(screen.queryByRole("heading", { name: "Conversations" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^Delete conversation/u }),
    ).toBeNull();
  });
});

describe("the time spoken", () => {
  useMockBackend();

  test("shows the weeks, the level and the pace already understood", async () => {
    open("time");

    const scene = await screen.findByRole("region", { name: "Time spoken" });
    // Week by week along its bottom, as it was under the staircase.
    expect(
      within(scene).getByRole("table", { name: "Time spoken per week" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Estimated level" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Best sentences" }),
    ).toBeInTheDocument();
    // What the ear understands is read from the listening, and shown here.
    expect(
      await screen.findByText("You already understand at"),
    ).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "By pace" })).toBeInTheDocument();
    expect(await within(scene).findByText(/days? in a row$/u)).toBeVisible();
  });
});
