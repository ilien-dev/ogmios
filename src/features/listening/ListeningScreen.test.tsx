import { beforeEach, describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { Route } from "@/app/routes";
import { showsNav } from "@/app/routes";
import { SpeechProvider } from "@/features/speech/speech";
import { mockSpoken, resetMockSpeech } from "@/lib/ipcMockSpeech";
import { useMockBackend } from "@/test/mockBackend";
import { ListeningScreen } from "./ListeningScreen";

/** The sentences the mock dictates, in its order. */
const FIRST = "The boy woke before the sirens did.";
const SECOND = "He lay still and counted the cracks in the ceiling;";
const DICTATED = [
  FIRST,
  SECOND,
  "there were eleven, the same as yesterday.",
  "He had not slept in three days.",
  "“You know what happens if you fall asleep here?” the man asked.",
  "Everyone knew what the trial did to those who entered it unprepared.",
  "They gave him a cot in a room with no windows.",
  "When he opened his eyes again, the room was gone.",
];

/** The listening section, as the app holds it. */
function Section(): ReactNode {
  const [route, setRoute] = useState<Route>({ name: "listening" });
  if (route.name !== "listening") {
    return <p>{`Left for ${route.name}`}</p>;
  }
  return (
    <SpeechProvider>
      {showsNav(route) && <nav aria-label="Sections" />}
      <ListeningScreen
        running={route.running ?? null}
        reading={route.reading ?? null}
        chapterId={route.chapterId ?? null}
        navigate={setRoute}
      />
    </SpeechProvider>
  );
}

/** The menu on the screen, with its chapter. */
async function open(): Promise<UserEvent> {
  const user = userEvent.setup();
  render(<Section />);
  await screen.findByRole("heading", { name: "Listening" });
  await screen.findByLabelText("Chapter");
  return user;
}

/** A dictation at its first sentence. */
async function begin(): Promise<UserEvent> {
  const user = await open();
  await user.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByLabelText("Type what you hear");
  return user;
}

/** Plays the sentence and waits until it was heard `times` in all. */
async function listen(user: UserEvent, times: number): Promise<void> {
  await user.click(screen.getByRole("button", { name: /^Listen/ }));
  await screen.findByText(times === 1 ? "1 listen" : `${times} listens`);
  await screen.findByRole("button", { name: /^Listen again/ });
}

/** Types an answer, checks it, and waits for what it was worth. */
async function write(user: UserEvent, text: string): Promise<void> {
  await user.click(screen.getByLabelText("Type what you hear"));
  await user.paste(text);
  await user.click(screen.getByRole("button", { name: /^Check/ }));
  await screen.findByText("What it said");
}

async function next(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("button", { name: /^Next/ }));
  await screen.findByLabelText("Type what you hear");
}

describe("listening", () => {
  useMockBackend();

  test("leads back to the book section it is opened from", async () => {
    const user = await open();

    await user.click(screen.getByRole("button", { name: "Book" }));
    expect(screen.getByText("Left for books")).toBeInTheDocument();
  });
  beforeEach(() => {
    resetMockSpeech(true);
  });

  test("without the voice the menu only offers to download it", async () => {
    resetMockSpeech(false);
    render(<Section />);
    expect(
      await screen.findByText(/Listening needs the voice/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Download the voice/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Dictation")).not.toBeInTheDocument();
  });

  test("the menu is on a chapter, with no pace understood yet", async () => {
    await open();
    expect(screen.getByText("No pace yet")).toBeInTheDocument();
    expect(screen.getByLabelText("Chapter")).toHaveValue("book-alice-0");
    const paces = within(screen.getByRole("list", { name: "By pace" }));
    expect(paces.getAllByText("Not tried yet")).toHaveLength(3);
    // A dictation is offered at the normal pace before anything is known.
    expect(screen.getByRole("button", { name: "Normal" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("10 sentences")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  test("a sentence heard and typed whole is right", async () => {
    const user = await begin();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 8")).toBeInTheDocument();
    // What it says is only heard.
    expect(screen.queryByText(FIRST)).not.toBeInTheDocument();
    await listen(user, 1);
    expect(mockSpoken()).toEqual([FIRST]);

    await write(user, "the boy woke before the sirens did");
    expect(screen.getByText("All of it")).toBeInTheDocument();
    await next(user);
    expect(screen.getByText("2 of 8")).toBeInTheDocument();
    await listen(user, 1);
    expect(mockSpoken().at(-1)).toBe(SECOND);
  });

  test("the words not typed are marked, and the sentence comes back", async () => {
    const user = await begin();
    await write(user, "the boy woke");
    expect(screen.getByText("3 of 7 words")).toBeInTheDocument();
    expect(screen.getByText("the boy woke")).toBeInTheDocument();
    const missed = screen.getByText("sirens");
    expect(missed).toHaveClass("text-wrong");
    expect(screen.getByText("boy")).not.toHaveClass("text-wrong");
    await next(user);
    expect(screen.getByText("2 of 9")).toBeInTheDocument();
  });

  test("a third listen is help", async () => {
    const user = await begin();
    await listen(user, 1);
    await listen(user, 2);
    await listen(user, 3);
    await write(user, FIRST);
    expect(screen.getByText("All of it, with help")).toBeInTheDocument();
    expect(
      screen.getByText("It took more than two listens."),
    ).toBeInTheDocument();
  });

  test("slowing down once it was heard is help", async () => {
    const user = await begin();
    await listen(user, 1);
    await user.click(screen.getByRole("button", { name: "Slow" }));
    await listen(user, 2);
    await write(user, FIRST);
    expect(screen.getByText("All of it, with help")).toBeInTheDocument();
    expect(screen.getByText(/You slowed it down/)).toBeInTheDocument();
  });

  test("a dictation paused waits in the menu to be gone on with", async () => {
    const user = await begin();
    await write(user, FIRST);
    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(await screen.findByText("1 of 8 sentences")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByLabelText("Type what you hear");
    expect(screen.getByText("2 of 8")).toBeInTheDocument();
  });

  test("one left with nothing typed is not kept", async () => {
    const user = await begin();
    await user.click(screen.getByRole("button", { name: "Pause" }));
    await screen.findByRole("heading", { name: "Listening" });
    await screen.findByLabelText("Chapter");
    expect(screen.queryByText("Paused")).not.toBeInTheDocument();
  });

  test("finishing says how it went and offers another", async () => {
    const user = await begin();
    await write(user, FIRST);
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: "Dictation done" });
    expect(
      screen.getByText("7 of 7 words heard, at normal pace."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No pace is yours yet: keep going."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Another dictation" }));
    await screen.findByLabelText("Type what you hear");
    expect(screen.getByText("1 of 8")).toBeInTheDocument();
  });

  test("a lost dictation suggests a slower pace for the next", async () => {
    const user = await begin();
    await user.click(screen.getByRole("button", { name: /^I don't know/ }));
    await screen.findByText("0 of 7 words");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: "Dictation done" });
    expect(screen.getByText(/A slower pace will help/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slow" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("ten sentences understood make the pace the learner's own", async () => {
    const user = await begin();
    for (const [at, sentence] of DICTATED.entries()) {
      await write(user, sentence);
      const last = at === DICTATED.length - 1;
      await user.click(
        screen.getByRole("button", {
          name: last ? /^See how it went/ : /^Next/,
        }),
      );
      if (!last) {
        await screen.findByLabelText("Type what you hear");
      }
    }
    await screen.findByRole("heading", { name: "Dictation done" });
    await user.click(screen.getByRole("button", { name: "Another dictation" }));
    await screen.findByLabelText("Type what you hear");
    await write(user, FIRST);
    await next(user);
    await write(user, SECOND);
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: "Dictation done" });
    expect(
      screen.getByText("You understand at normal pace."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByLabelText("Chapter");
    expect(screen.getByText("You already understand at")).toBeInTheDocument();
    expect(screen.queryByText("No pace yet")).not.toBeInTheDocument();
    expect(screen.getByText("100% · 10 sentences")).toBeInTheDocument();
    expect(screen.getAllByLabelText("This pace is yours")).toHaveLength(1);
    // The next one is offered a pace above.
    expect(screen.getByRole("button", { name: "Fast" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("words missed more than once are the ones that escape", async () => {
    const user = await begin();
    for (const round of [1, 2]) {
      await user.click(screen.getByRole("button", { name: /^I don't know/ }));
      await screen.findByText("0 of 7 words");
      await user.click(screen.getByRole("button", { name: "Finish" }));
      await screen.findByRole("heading", { name: "Dictation done" });
      if (round === 1) {
        await user.click(
          screen.getByRole("button", { name: "Another dictation" }),
        );
        await screen.findByLabelText("Type what you hear");
      }
    }
    await user.click(screen.getByRole("button", { name: "Done" }));
    await screen.findByLabelText("Chapter");
    expect(screen.getByText("What escapes you most")).toBeInTheDocument();
    // Missed twice, "boy" is shown. "the" is twice in the sentence: missed
    // four times, it is reinforced as well.
    expect(screen.getAllByText("boy")).toHaveLength(1);
    expect(screen.getByText("Being reinforced")).toBeInTheDocument();
    expect(screen.getAllByText("the")).toHaveLength(2);
  });

  test("a chapter is read aloud a sentence after another", async () => {
    const user = await open();
    await user.click(screen.getByRole("button", { name: "Listen" }));
    await screen.findByRole("heading", { name: "I. Down the Rabbit-Hole" });
    expect(screen.getByText("Sentence 1 of 10")).toBeInTheDocument();
    expect(screen.getByText(FIRST)).toHaveAttribute("aria-current", "true");

    // A sentence clicked is where the reading goes on from.
    await user.click(screen.getByText("He had not slept in three days."));
    expect(screen.getByText("Sentence 4 of 10")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => {
      expect(mockSpoken()).toHaveLength(7);
    });
    expect(mockSpoken()[0]).toBe("He had not slept in three days.");
    // Heard to its end, it is back at the top.
    await screen.findByRole("button", { name: "Play" });
    expect(await screen.findByText("Sentence 1 of 10")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Only listen" }));
    expect(screen.queryByText(FIRST)).not.toBeInTheDocument();
    expect(
      screen.getByText("The text is hidden. Just listen."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Listening" }));
    await screen.findByLabelText("Chapter");
  });
});
