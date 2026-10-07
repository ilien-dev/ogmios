import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { Route } from "@/app/routes";
import { showsNav } from "@/app/routes";
import { seedMockReadiness } from "@/lib/ipcMockChapters";
import { useMockBackend } from "@/test/mockBackend";
import { RecallScreen } from "./RecallScreen";

/** A right answer to each word the seeded shelf has finished. */
const RIGHT: Record<string, string> = {
  waistcoat: "chaleco",
  marmalade: "mermelada",
  peep: "asomarse",
  "rabbit hole": "madriguera",
  tumble: "caerse",
  curtsey: "reverencia",
  "give up": "rendirse",
};

/** The recall section, as the app holds it. */
function Section(): ReactNode {
  const [route, setRoute] = useState<Route>({ name: "recall" });
  if (route.name !== "recall") {
    return <p>{`Left for ${route.name}`}</p>;
  }
  return (
    <>
      {showsNav(route) && <nav aria-label="Sections" />}
      <RecallScreen
        nativeLang="es"
        running={route.running ?? null}
        navigate={setRoute}
      />
    </>
  );
}

function prompt(): string {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

/** The seeded shelf, and a run towards Spanish just started. */
async function begin(): Promise<UserEvent> {
  seedMockReadiness();
  const user = userEvent.setup();
  render(<Section />);
  await start(user);
  return user;
}

async function start(user: UserEvent): Promise<void> {
  await user.click(await screen.findByRole("radio", { name: /^English → / }));
  await user.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByLabelText("Your translation");
}

describe("the daily recall", () => {
  useMockBackend();

  test("leads back to the book section it is opened from", async () => {
    const user = userEvent.setup();
    render(<Section />);

    await user.click(await screen.findByRole("button", { name: "Book" }));
    expect(screen.getByText("Left for books")).toBeInTheDocument();
  });

  test("with nothing learned it says where its words come from", async () => {
    render(<Section />);
    expect(
      await screen.findByText(
        "Words you finish in a book or ask for in a conversation come back here.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  test("asks the words that are due and sends the right ones away", async () => {
    seedMockReadiness();
    const user = userEvent.setup();
    render(<Section />);
    const waiting = await screen.findByText(/^\d+ words are waiting today$/u);
    const due = Number.parseInt(waiting.textContent, 10);
    expect(screen.getByText(`${String(due)} new`)).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();

    // A run takes the whole window, the keyboard in the answer.
    await start(user);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByLabelText("Your translation")).toHaveFocus();
    // Its words are learned: nothing to say "I know this" or "I was right" to.
    expect(screen.queryByRole("button", { name: "I know this" })).toBeNull();

    for (let asked = 0; asked < due; asked += 1) {
      const word = prompt();
      await user.keyboard(`${RIGHT[word] ?? ""}{Enter}`);
      expect(await screen.findByText("Right.")).toBeInTheDocument();
      await user.keyboard("{Enter}");
    }
    expect(
      await screen.findByRole("heading", { name: "Reviewed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${String(due)} words remembered`),
    ).toBeInTheDocument();
    expect(screen.getByText("Nothing slipped.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Another round" })).toBeNull();

    // Back between runs: nothing is due, and every word is a step stronger.
    await user.keyboard("{Enter}");
    expect(
      await screen.findByText("Nothing to review today. Come back tomorrow."),
    ).toBeInTheDocument();
    expect(screen.getByText(`${String(due)} settling`)).toBeInTheDocument();
    expect(screen.getByText("0 new")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  test("a run of both ways asks its new words from both sides", async () => {
    seedMockReadiness();
    const user = userEvent.setup();
    render(<Section />);
    await user.click(await screen.findByRole("radio", { name: "Both" }));
    await user.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByLabelText("Your translation");

    // The first from English, the next towards it.
    const first = prompt();
    await user.keyboard(`${RIGHT[first] ?? ""}{Enter}`);
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    await screen.findByLabelText("Your translation");
    const [english] = Object.entries(RIGHT).find(
      ([, spanish]) => spanish === prompt(),
    ) ?? [""];
    await user.keyboard(`${english}{Enter}`);
    expect(await screen.findByText("Right.")).toBeInTheDocument();
  });

  test("a word that keeps slipping offers the learner a note of their own", async () => {
    const user = await begin();
    const word = prompt();
    const miss = async (): Promise<void> => {
      expect(prompt()).toBe(word);
      await user.keyboard("nope{Enter}");
      expect(await screen.findByText("Not quite.")).toBeInTheDocument();
    };
    const again = async (): Promise<void> => {
      await user.click(
        screen.getByRole("button", { name: "Leave the review" }),
      );
      await start(user);
    };

    // Two misses are misses; the third makes it one that keeps slipping.
    await miss();
    expect(screen.queryByText("This one keeps slipping")).toBeNull();
    await again();
    await miss();
    expect(screen.queryByText("This one keeps slipping")).toBeNull();
    await again();
    await miss();
    expect(screen.getByText("This one keeps slipping")).toBeInTheDocument();
    // Enter still goes on: the note is the learner's to write or not.
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();

    await user.type(screen.getByLabelText("Your note"), "a coat for the waist");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    // The next time it slips, the note is there to read.
    await again();
    await miss();
    expect(screen.getByLabelText("Your note")).toHaveValue(
      "a coat for the waist",
    );
  });

  test("a run with a miss says so and offers another round", async () => {
    const user = await begin();
    await user.keyboard("nope{Enter}");
    expect(await screen.findByText("Not quite.")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    while (screen.queryByRole("heading", { name: "Reviewed" }) === null) {
      await user.keyboard(`${RIGHT[prompt()] ?? ""}{Enter}`);
      expect(await screen.findByText("Right.")).toBeInTheDocument();
      await user.keyboard("{Enter}");
    }
    expect(screen.getByText("1 word comes back tomorrow")).toBeInTheDocument();
    const more = screen.getByRole("button", { name: "Another round" });
    expect(more).toHaveFocus();

    // The other round asks the word that slipped, and only it.
    await user.keyboard("{Enter}");
    await screen.findByLabelText("Your translation");
    await user.keyboard(`${RIGHT[prompt()] ?? ""}{Enter}`);
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("1 word remembered")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus();
  });
});
