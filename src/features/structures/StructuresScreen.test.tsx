import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { Route } from "@/app/routes";
import { showsNav } from "@/app/routes";
import { useMockBackend } from "@/test/mockBackend";
import { StructuresScreen } from "./StructuresScreen";

/** The structures section, as the app holds it. */
function Section({ hub = false }: { hub?: boolean }): ReactNode {
  const [route, setRoute] = useState<Route>({
    name: "structures",
    catalog: !hub,
  });
  if (route.name !== "structures") {
    return <p>{`Left for ${route.name}`}</p>;
  }
  return (
    <>
      {showsNav(route) && <nav aria-label="Sections" />}
      <StructuresScreen
        running={route.running ?? null}
        catalog={route.catalog === true}
        chapterId={route.chapterId ?? null}
        bookId={route.bookId ?? null}
        navigate={setRoute}
      />
    </>
  );
}

/** The form of the structure, as it reads with its terms put together. */
function form(): string | null {
  return (
    screen.queryByRole("complementary")?.querySelector("p")?.textContent ?? null
  );
}

function asked(): string {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

/** The menu on the screen, with every structure listed. */
async function open(): Promise<UserEvent> {
  const user = userEvent.setup();
  render(<Section />);
  await screen.findByRole("heading", { name: "Free session" });
  return user;
}

/** A session of ten on "Can / can't" alone, at its first sentence. */
async function begin(): Promise<UserEvent> {
  const user = await open();
  await user.click(screen.getByRole("button", { name: /^Can \/ can't/ }));
  await user.click(screen.getByRole("radio", { name: /^10 · Quick/ }));
  await user.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByLabelText("Your sentence, in English");
  return user;
}

/** Writes a sentence, checks it, and waits for what it was worth. */
async function write(user: UserEvent, sentence: string): Promise<void> {
  await user.type(screen.getByLabelText("Your sentence, in English"), sentence);
  await user.click(screen.getByRole("button", { name: /^Check/ }));
  await screen.findByText("One way to say it");
}

async function next(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("button", { name: /^Next/ }));
  await screen.findByLabelText("Your sentence, in English");
}

describe("the structures section", () => {
  useMockBackend();

  test("opens on a card for any structure and one for the chapter's", async () => {
    const user = userEvent.setup();
    render(<Section hub />);

    const free = await screen.findByRole("button", { name: /^Free session/ });
    expect(free.textContent).toContain("36 structures · 0 firm");
    expect(
      screen.getByRole("button", { name: /^From the chapter/ }).textContent,
    ).toContain("Alice's Adventures in Wonderland · I. Down the Rabbit-Hole");
    expect(screen.queryByRole("button", { name: /^Paused/ })).toBeNull();

    await user.click(free);
    await screen.findByRole("heading", { name: "Free session" });
    await user.click(screen.getByRole("button", { name: "Structures" }));
    await screen.findByRole("button", { name: /^Free session/ });
  });

  test("the chapter's card opens the structures of the chapter", async () => {
    const user = userEvent.setup();
    render(<Section hub />);

    await user.click(
      await screen.findByRole("button", { name: /^From the chapter/ }),
    );
    await screen.findByRole("heading", { name: "Chapter structures" });
  });

  test("with no book on the shelf there is no card for a chapter", async () => {
    const { clearMockBooks } = await import("@/lib/ipcMockBooks");
    clearMockBooks();
    render(<Section hub />);

    await screen.findByRole("button", { name: /^Free session/ });
    expect(
      screen.queryByRole("button", { name: /^From the chapter/ }),
    ).toBeNull();
  });

  test("with several sessions paused, the card opens the menu that lists them", async () => {
    const user = await begin();
    await write(user, "I can peep now.");
    await user.click(screen.getByRole("button", { name: "Pause" }));
    await user.click(
      await screen.findByRole("button", { name: /^Free session/ }),
    );
    await user.click(screen.getByRole("button", { name: /^Can \/ can't/ }));
    await user.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByLabelText("Your sentence, in English");
    await write(user, "I can't peep now.");
    await user.click(screen.getByRole("button", { name: "Pause" }));

    const card = await screen.findByRole("button", { name: /^Paused/ });
    expect(card.textContent).toContain("2 sessions");
    await user.click(card);
    await screen.findByRole("heading", { name: "Paused" });
    expect(screen.getAllByRole("button", { name: "Continue" })).toHaveLength(2);
  });
});

describe("the structures menu", () => {
  useMockBackend();

  test("lists every structure, and only a level's once one is chosen", async () => {
    const user = await open();
    const all = (): HTMLElement[] =>
      screen
        .getAllByRole("button")
        .filter((button) => button.hasAttribute("aria-pressed"))
        .filter((button) => within(button).queryByRole("img") !== null);
    expect(all()).toHaveLength(36);
    expect(screen.getByText("None picked: the 36 listed, mixed")).toBeDefined();
    expect(
      screen.getByRole("button", { name: /^Present perfect have \/ has/ }),
    ).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Advanced" }));
    expect(all()).toHaveLength(12);
    expect(screen.queryByRole("button", { name: /^Can \/ can't/ })).toBeNull();
    expect(screen.getByText("None picked: the 12 listed, mixed")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /^I wish/ }));
    await user.click(screen.getByRole("button", { name: /^Inversion/ }));
    expect(screen.getByText("2 structures")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(all()).toHaveLength(36);
    expect(screen.getByText("2 structures")).toBeDefined();
  });

  test("offers four sizes and starts on the normal one", async () => {
    await open();
    const sizes = screen.getAllByRole("radio");
    expect(sizes.map((size) => size.getAttribute("value"))).toEqual([
      "10",
      "20",
      "40",
      "60",
    ]);
    expect(
      screen.getByRole<HTMLInputElement>("radio", { name: /^20 · Normal/ })
        .checked,
    ).toBe(true);
  });
});

describe("a session of structures", () => {
  useMockBackend();

  test("asks for a sentence with a structure and a word, and takes the window", async () => {
    await begin();
    // The word is what it is built on: it is about nothing else.
    expect(asked()).toBe("Write a sentence with “Can / can't”.");
    expect(screen.getByText("peep")).toBeDefined();
    expect(screen.getByText("from your chapter")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Can / can't" }).closest("p")
        ?.textContent,
    ).toBe("Can / can't · Basic · warm-up");
    expect(screen.getByText("1 of 10")).toBeDefined();
    expect(screen.queryByRole("navigation")).toBeNull();
    // In the warm-up the form is there to read.
    expect(form()).toBe("can / can't + verb");
    expect(screen.getByRole("button", { name: "Pause" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Finish" })).toBeDefined();
  });

  test("says what the sentence is for, with an example of the idea", async () => {
    const user = await begin();
    expect(
      screen.getByText("Say what someone is able to do, or isn't."),
    ).toBeDefined();
    expect(
      screen.getByText(
        "The idea, for example: Swimming: not one of my skills.",
      ),
    ).toBeDefined();
    // The name on the tag says what it is for when asked.
    await user.hover(screen.getByRole("button", { name: "Can / can't" }));
    expect(screen.getByRole("tooltip").textContent).toBe(
      "Say what someone is able to do, or isn't.",
    );
  });

  test("explains each grammar word of the form on the word itself", async () => {
    const user = await begin();
    await user.hover(screen.getByRole("button", { name: "verb" }));
    expect(screen.getByRole("tooltip").textContent).toBe(
      "The action word, as the dictionary lists it: go, eat.",
    );
    await user.unhover(screen.getByRole("button", { name: "verb" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  test("the word asked for says its kind and what it means when asked", async () => {
    const user = await begin();
    const word = screen.getByRole("button", { name: "peep" });
    expect(word.closest("p")?.textContent).toBe(
      "Use the wordpeepfrom your chapter",
    );
    await user.hover(word);
    expect(screen.getByRole("tooltip").textContent).toBe(
      "verb · asomarse, echar un vistazo",
    );
    await user.unhover(word);
    expect(screen.queryByRole("tooltip")).toBeNull();
    // It stays off the way of Tab: the field is where the learner writes.
    expect(word.tabIndex).toBe(-1);
  });

  test("a word that doesn't fit is dropped, and the sentence costs nothing", async () => {
    const user = await begin();
    await user.type(
      screen.getByLabelText("Your sentence, in English"),
      "I can do",
    );
    await user.click(screen.getByRole("button", { name: "It doesn't fit" }));
    await screen.findByText(
      "Write a sentence with “Can / can't” about a trip.",
    );
    expect(screen.queryByText("Use the word")).toBeNull();
    expect(screen.queryByRole("button", { name: "It doesn't fit" })).toBeNull();
    // What was written already stays.
    await write(user, " it.");
    expect(screen.getByText("I can do it.")).toBeDefined();
    expect(screen.getByText("Right")).toBeDefined();
  });

  test("says what a sentence was worth and shows a right one", async () => {
    const user = await begin();
    await write(user, "I can peep through it.");
    expect(screen.getByText("Right")).toBeDefined();
    expect(screen.getByText("I can peep through it.")).toBeDefined();
    // In the form, to the right, and as the right way to say it.
    expect(screen.getAllByText("I can't swim very well.")).toHaveLength(2);

    await next(user);
    expect(screen.getByText("2 of 10")).toBeDefined();
    await write(user, "I can do it.");
    expect(screen.getByText("Right, with help")).toBeDefined();
    expect(
      screen.getByText("“tumble”, the word asked for, is missing."),
    ).toBeDefined();
  });

  test("a sentence not known is wrong and comes back at the end", async () => {
    const user = await begin();
    await user.click(screen.getByRole("button", { name: /^I don't know/ }));
    await screen.findByText("One way to say it");
    expect(screen.getByText("Not yet")).toBeDefined();
    expect(screen.getByText("No answer")).toBeDefined();
    await next(user);
    expect(screen.getByText("2 of 11")).toBeDefined();
  });

  test("after the warm-up the form is asked for, and costs a clean answer", async () => {
    const user = await begin();
    for (const word of ["peep", "tumble", "give up"]) {
      await write(user, `I can ${word} here.`);
      await next(user);
    }
    // Not verbs alone: a noun of the chapter, in its own colour.
    const noun = screen.getByRole("button", { name: "bank" });
    expect(noun.className).toContain("text-noun");
    await user.hover(noun);
    expect(screen.getByRole("tooltip").textContent).toBe(
      "noun · orilla, ribera",
    );
    await user.unhover(noun);
    expect(
      screen.getByRole("button", { name: "Can / can't" }).closest("p")
        ?.textContent,
    ).toBe("Can / can't · Basic");
    expect(screen.queryByRole("button", { name: "verb" })).toBeNull();
    // What the sentence is for stays: it is the form that has to be recalled.
    expect(
      screen.getByText("Say what someone is able to do, or isn't."),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: /^Show the form/ }));
    expect(form()).toBe("can / can't + verb");
    await write(user, "I can bank here.");
    expect(screen.getByText("Right, with help")).toBeDefined();
    expect(
      screen.getByText("You looked at the form: it counts as right with help."),
    ).toBeDefined();
  });

  test("Enter checks and Alt+N is not knowing", async () => {
    const user = await begin();
    await user.type(
      screen.getByLabelText("Your sentence, in English"),
      "I can peep now.{Enter}",
    );
    await screen.findByText("Right");
    await user.keyboard("{Enter}");
    const field = await screen.findByLabelText("Your sentence, in English");
    field.focus();
    await user.keyboard("{Alt>}n{/Alt}");
    await screen.findByText("Not yet");
  });

  test("paused, it waits on a card to be gone on with, and in the menu to be finished", async () => {
    const user = await begin();
    await write(user, "I can peep now.");
    await user.click(screen.getByRole("button", { name: "Pause" }));
    const card = await screen.findByRole("button", { name: /^Paused/ });
    expect(card.textContent).toContain("1 of 10 sentences");
    expect(screen.getByRole("navigation")).toBeDefined();

    await user.click(card);
    await screen.findByLabelText("Your sentence, in English");
    expect(screen.getByText("2 of 10")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Pause" }));
    await user.click(
      await screen.findByRole("button", { name: /^Free session/ }),
    );
    await screen.findByRole("heading", { name: "Paused" });
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByText("None picked: the 36 listed, mixed");
    expect(screen.queryByRole("heading", { name: "Paused" })).toBeNull();
  });

  test("left with nothing written, it is not kept", async () => {
    const user = await begin();
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: "Structures" });
    expect(screen.queryByRole("heading", { name: "Paused" })).toBeNull();
  });

  test("finished, it says how each structure went and offers another", async () => {
    const user = await begin();
    await write(user, "I can peep now.");
    await next(user);
    await user.click(screen.getByRole("button", { name: /^I don't know/ }));
    await screen.findByText("One way to say it");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: "Session finished" });
    expect(screen.getByText("You wrote 2 sentences.")).toBeDefined();
    expect(screen.getByText("Can / can't")).toBeDefined();
    expect(screen.getByText("1 of 2")).toBeDefined();

    await user.click(
      screen.getByRole("button", { name: "Continue with another session" }),
    );
    await screen.findByLabelText("Your sentence, in English");
    expect(screen.getByText("1 of 10")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: "Structures" });
  });
});

describe("the structures of a chapter", () => {
  useMockBackend();

  test("are read once from the menu's card, and practised with its words", async () => {
    const user = await open();
    expect(
      screen.getByText(
        "Alice's Adventures in Wonderland · I. Down the Rabbit-Hole",
      ),
    ).toBeDefined();
    await user.click(
      screen.getByRole("button", { name: "Find this chapter's structures" }),
    );
    // Read in place, with the reading in sight until it is done.
    expect(screen.getByRole("status").textContent).toContain(
      "Reading the chapter…",
    );
    expect(
      screen.getByRole("progressbar", { name: "How far the reading is" }),
    ).toBeDefined();
    await user.click(
      await screen.findByRole("button", { name: "Practise the chapter's" }),
    );
    expect(screen.queryByRole("status")).toBeNull();
    await screen.findByRole("heading", { name: "Chapter structures" });
    await screen.findByText("Past simple");
    expect(screen.getByText("212 sentences")).toBeDefined();
    expect(
      screen.getByText("Alice was beginning to get very tired."),
    ).toBeDefined();
    expect(screen.getByText("With words from this chapter")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByLabelText("Your sentence, in English");
    expect(asked()).toBe("Write a sentence with “Past simple”.");
    expect(screen.getByText("1 of 20")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Pause" }));
    await user.click(
      await screen.findByRole("button", { name: /^Free session/ }),
    );
    // Read already: the card lists them and goes straight to practising.
    expect(
      screen.getByRole("button", { name: "Practise the chapter's" }),
    ).toBeDefined();
    expect(screen.getByText(/48 sentences/)).toBeDefined();
  });

  test("with no book on the shelf there is no chapter and no word", async () => {
    const { clearMockBooks } = await import("@/lib/ipcMockBooks");
    clearMockBooks();
    const user = await open();
    expect(
      screen.queryByRole("button", { name: "Find this chapter's structures" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Start" }));
    await screen.findByLabelText("Your sentence, in English");
    expect(screen.queryByText("Use the word")).toBeNull();
    expect(asked()).toBe(
      "Write a sentence with “Present simple” about a trip.",
    );
  });
});
