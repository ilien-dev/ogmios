import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { Route } from "@/app/routes";
import { useMockBackend } from "@/test/mockBackend";
import { BooksScreen } from "./BooksScreen";

/** A right answer to each prompt of the mock chapter, whichever way. */
const RIGHT: Record<string, string> = {
  "rabbit hole": "madriguera",
  madriguera: "rabbit hole",
  tumble: "rodar",
  "caerse, rodar": "tumbled",
  curtsey: "reverencia",
  "hacer una reverencia, reverencia": "curtsey",
  waistcoat: "chaleco",
  chaleco: "waistcoat",
  "give up": "rendirse",
  "rendirse, dejar": "give up",
  marmalade: "mermelada",
  mermelada: "marmalade",
  peep: "asomarse",
  "asomarse, echar un vistazo": "peep",
  hedge: "seto",
  seto: "hedge",
};

/** The word every miss is given to, whichever way it is asked. */
const MISSED = new Set(["rabbit hole", "madriguera"]);

function Shelf(): ReactNode {
  const [route, setRoute] = useState<Route>({
    name: "books",
    bookId: "book-alice",
    chapterId: "book-alice-0",
  });
  if (route.name !== "books") {
    return null;
  }
  return (
    <BooksScreen
      nativeLang="es"
      bookId={route.bookId}
      chapterId={route.chapterId ?? null}
      practising={route.practising === true}
      navigate={setRoute}
    />
  );
}

function prompt(): string {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

function inPenalty(): boolean {
  return document.querySelector("[data-penalty]") !== null;
}

/** Types an answer, checks it, and goes on with Enter once it is judged. */
async function answer(
  user: UserEvent,
  text: string,
  verdict: string,
): Promise<void> {
  await user.keyboard(`${text}{Enter}`);
  expect(await screen.findByText(verdict)).toBeInTheDocument();
  await user.keyboard("{Enter}");
}

/** Starts practice and misses "rabbit hole" until its penalty opens. */
async function untilPenalty(user: UserEvent): Promise<void> {
  render(<Shelf />);
  await user.click(await screen.findByRole("button", { name: "Practice" }));
  await user.click(await screen.findByRole("button", { name: "Start" }));
  await screen.findByLabelText("Your translation");
  for (let turn = 0; turn < 40; turn += 1) {
    if (screen.queryByText("This word keeps slipping away") !== null) {
      return;
    }
    const shown = prompt();
    if (MISSED.has(shown)) {
      await user.click(screen.getByRole("button", { name: /I don't know/u }));
      expect(await screen.findByText("Here it is.")).toBeInTheDocument();
      await user.keyboard("{Enter}");
    } else {
      await answer(user, RIGHT[shown] ?? "", "Right.");
    }
    await screen.findByRole("heading", { level: 1 });
  }
  throw new Error("no penalty came");
}

describe("PenaltyRun", () => {
  useMockBackend();

  test("three misses in a row open a penalty the learner answers through", async () => {
    const user = userEvent.setup();
    await untilPenalty(user);

    // The window turns to the penalty's night, and says what it asks.
    expect(inPenalty()).toBe(true);
    expect(
      screen.getByText("Penalty review · rung 1 of 4"),
    ).toBeInTheDocument();
    expect(prompt()).toBe("rabbit hole");
    expect(screen.getByText("madriguera")).toBeInTheDocument();
    expect(
      screen.getByRole("listitem", { name: "3 + 3, this one" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toHaveFocus();
    await user.keyboard("{Enter}");

    // No hint, no "I know this": only the answer, or "I don't know".
    await screen.findByLabelText("Your translation");
    expect(screen.getByText("0 of 6 in a row")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hint/u })).toBeNull();
    expect(screen.queryByRole("button", { name: "I know this" })).toBeNull();

    await answer(user, RIGHT[prompt()] ?? "", "Right.");
    await answer(user, RIGHT[prompt()] ?? "", "Right.");
    expect(await screen.findByText("2 of 6 in a row")).toBeInTheDocument();

    // A miss starts it over, and says where it was.
    await answer(user, "no", "Not quite.");
    expect(
      await screen.findByText("Back to the first: you were on 3."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 of 6 in a row")).toBeInTheDocument();

    for (let count = 0; count < 6; count += 1) {
      await screen.findByText(`${String(count)} of 6 in a row`);
      await answer(user, RIGHT[prompt()] ?? "", "Right.");
    }

    // Through: the rung is passed, and the next one is said.
    expect(
      await screen.findByText("6 of 6 without a miss."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("listitem", { name: "3 + 3, passed" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/the next rung is 6 \+ 6/u)).toBeInTheDocument();
    const back = screen.getByRole("button", { name: "Back to the chapter" });
    expect(back).toHaveFocus();
    await user.keyboard("{Enter}");

    // The usual practice goes on, in its usual colours.
    await screen.findByRole("progressbar", { name: "Session progress" });
    expect(inPenalty()).toBe(false);
    expect(screen.getByLabelText("Your translation")).toBeInTheDocument();
  });
});
