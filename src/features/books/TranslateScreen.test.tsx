import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { Route } from "@/app/routes";
import { setMockTranslateFails } from "@/lib/ipcMockTranslate";
import { useMockBackend } from "@/test/mockBackend";
import { BooksScreen } from "./BooksScreen";

const THERE = "From English into Spanish";
const BACK = "From Spanish into English";
const FIELD = "Your translation of the marked sentence";
const FIRST = "The boy woke before the sirens did.";
const SECOND = "He lay still and counted the cracks in the ceiling;";
const NEXT = "He had not slept in three days.";

/** The books section on a chapter never prepared, as the app holds it. */
function Shelf(): ReactNode {
  const [route, setRoute] = useState<Route>({
    name: "books",
    bookId: "book-alice",
    chapterId: "book-alice-1",
  });
  if (route.name !== "books") {
    return null;
  }
  return (
    <BooksScreen
      nativeLang="es"
      bookId={route.bookId}
      chapterId={route.chapterId ?? null}
      translating={route.translating === true}
      navigate={setRoute}
    />
  );
}

function button(name: string | RegExp): HTMLElement {
  return screen.getByRole("button", { name });
}

/** The chapter of the mock, on the choice of a direction. */
async function open(): Promise<UserEvent> {
  const user = userEvent.setup();
  render(<Shelf />);
  await user.click(
    await screen.findByRole("button", { name: "Translate the chapter" }),
  );
  await screen.findByRole("button", { name: new RegExp(THERE, "u") });
  return user;
}

/** Starts a new attempt in a direction. */
async function begin(user: UserEvent, direction: string): Promise<void> {
  await user.click(button(new RegExp(direction, "u")));
  await screen.findByLabelText(FIELD);
}

/** Leaves the attempt on the screen, paused or finished. */
async function leave(user: UserEvent, how: string): Promise<void> {
  await user.click(button(how));
  await screen.findByRole("button", { name: new RegExp(THERE, "u") });
}

/** The sentence the marker is on. */
function marked(): string {
  return document.querySelector("mark")?.textContent ?? "";
}

/** What a review marked on the screen: each fragment and how it weighs. */
function marks(): Array<[string, string]> {
  return [...document.querySelectorAll("[data-severity]")].map((mark) => [
    mark.textContent,
    mark.getAttribute("data-severity") ?? "",
  ]);
}

/** What the learner wrote in each translated paragraph still in sight. */
function inSight(): string[] {
  return [...document.querySelectorAll("li:not([aria-hidden])")]
    .filter((row) => row.querySelector("[aria-label^='Score'], svg") !== null)
    .filter((row) => row.querySelector("textarea") === null)
    .map((row) => (row.querySelector("p")?.textContent ?? "").trim());
}

/** Writes sentences one after another, each sent with Enter. */
async function write(user: UserEvent, sentences: string[]): Promise<void> {
  for (const sentence of sentences) {
    const before = marked();
    await user.type(screen.getByLabelText(FIELD), `${sentence}{Enter}`);
    await waitFor(() => {
      expect(marked()).not.toBe(before);
    });
  }
}

describe("translating a chapter", () => {
  useMockBackend();

  test("a chapter is translated whether or not its words were learned", async () => {
    const user = userEvent.setup();
    render(<Shelf />);
    // Not prepared: the choice of how many words to learn is still there.
    expect(
      await screen.findByText("How many words do you want to learn?"),
    ).toBeInTheDocument();
    await user.click(button("Translate the chapter"));
    await screen.findByRole("button", { name: new RegExp(THERE, "u") });

    // Back into English waits for a paragraph translated the other way,
    // and there is no attempt to show yet.
    expect(button(new RegExp(BACK, "u"))).toBeDisabled();
    expect(screen.queryByText("Your attempts")).toBeNull();

    await begin(user, THERE);
    // The direction holds for the session: the only ways out are the two
    // under the paragraph.
    expect(screen.getByText("English → Spanish")).toBeInTheDocument();
    expect(screen.getByText("Paragraph 1 of 4")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^From /u })).toBeNull();
    expect(button("Pause")).toBeInTheDocument();
    expect(button("Finish session")).toBeInTheDocument();
    expect(screen.getByLabelText(FIELD)).toHaveFocus();
    expect(marked()).toBe(FIRST);
  });

  test("only the paragraph being translated is shown, a sentence at a time", async () => {
    const user = await open();
    await begin(user, THERE);
    // The paragraphs further on are not on the screen.
    expect(screen.queryByText(new RegExp(NEXT, "u"))).toBeNull();

    // Enter on nothing writes nothing.
    await user.type(screen.getByLabelText(FIELD), "  {Enter}");
    expect(marked()).toBe(FIRST);

    await write(user, ["Uno.", "Dos;"]);
    expect(marked()).toBe("there were eleven, the same as yesterday.");

    // A sentence already written is written again, and the marker comes back.
    await user.click(button(/Write this sentence again: Uno\./u));
    expect(marked()).toBe(FIRST);
    expect(screen.getByLabelText(FIELD)).toHaveValue("Uno.");
    await user.type(screen.getByLabelText(FIELD), " Otra vez.{Enter}");
    await screen.findByText("Uno. Otra vez.");

    // Whole, the paragraph gives way to the next one and stays above it
    // with its score and its marks, and nothing to read about them yet.
    await write(user, ["Tres."]);
    expect(marked()).toBe(NEXT);
    expect(screen.getByText("Paragraph 2 of 4")).toBeInTheDocument();
    expect(
      await screen.findByLabelText("Score: 70 out of 100"),
    ).toBeInTheDocument();
    expect(marks()).toEqual([
      ["Uno.", "error"],
      ["Tres.", "slip"],
    ]);
    expect(screen.queryByText(/«did» repite/u)).toBeNull();
    expect(screen.queryByRole("button", { name: /review/iu })).toBeNull();
  });

  test("the last two paragraphs stay in sight and the one before leaves", async () => {
    const user = await open();
    await begin(user, THERE);
    await write(user, ["Uno.", "Dos;", "Tres."]);
    await write(user, ["Cuatro.", "Cinco;", "Seis."]);
    expect(inSight()).toEqual(["Uno. Dos; Tres.", "Cuatro. Cinco; Seis."]);

    await write(user, ["Siete.", "Ocho."]);
    expect(screen.getByText("Paragraph 4 of 4")).toBeInTheDocument();
    expect(inSight()).toEqual(["Cuatro. Cinco; Seis.", "Siete. Ocho."]);
    // The first one is on its way out: there, and not to be read.
    const leaving = document.querySelectorAll('li[aria-hidden="true"]');
    expect(leaving).toHaveLength(1);
    expect(leaving[0]?.textContent).toContain("Uno. Dos; Tres.");
  });

  test("a review that fails says why and can be asked for again", async () => {
    const user = await open();
    await begin(user, THERE);
    setMockTranslateFails(true);
    await write(user, ["Uno.", "Dos;", "Tres."]);
    expect(
      await screen.findByText(
        "This paragraph couldn't be reviewed: Claude could not be reached",
      ),
    ).toBeInTheDocument();

    setMockTranslateFails(false);
    await user.click(button("Try again"));
    expect(await screen.findByLabelText(/^Score: /u)).toBeInTheDocument();
  });

  test("an attempt is paused and gone on with, or finished and read", async () => {
    const user = await open();
    // Left with nothing written, an attempt is not kept.
    await begin(user, THERE);
    await leave(user, "Pause");
    expect(screen.queryByText("Your attempts")).toBeNull();
    await begin(user, THERE);
    await leave(user, "Finish session");
    expect(screen.queryByText("Your attempts")).toBeNull();

    await begin(user, THERE);
    await write(user, ["Uno."]);
    await leave(user, "Pause");
    const list = within(
      screen.getByText("Your attempts").closest("section") ?? document.body,
    );
    expect(list.getByText(/0 of 4 paragraphs · Paused/u)).toBeInTheDocument();

    // Gone on with from the sentence it was left on.
    await user.click(list.getByRole("button", { name: "Continue" }));
    await screen.findByLabelText(FIELD);
    expect(marked()).toBe(SECOND);
    expect(button(/Write this sentence again: Uno\./u)).toBeInTheDocument();
    await write(user, ["Dos;", "Tres."]);

    // Finished, it is read at once: a summary, then each paragraph in full.
    await user.click(button("Finish session"));
    expect(await screen.findByText("What matters most")).toBeInTheDocument();
    expect(screen.getByText("What came back")).toBeInTheDocument();
    expect(screen.getByText("Overall score")).toBeInTheDocument();
    expect(screen.queryByLabelText(FIELD)).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    // On the right the English over what was written; on the left why.
    expect(screen.getByText("English")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(FIRST, "u"))).toBeInTheDocument();
    expect(screen.getByText("Your translation")).toBeInTheDocument();
    expect(screen.getByText(/→ El chico/u)).toBeInTheDocument();
    expect(screen.getByText(/«did» repite el verbo/u)).toBeInTheDocument();
    expect(marks().at(-1)).toEqual(["Tres.", "slip"]);

    // A word the review names is added to the chapter's practice from here.
    await user.click(button("Add “siren” to practice"));
    expect(
      await screen.findByRole("button", {
        name: "“siren” is in your practice",
      }),
    ).toBeDisabled();

    await leave(user, "Your attempts");
    expect(
      screen.getByText(/1 of 4 paragraphs · Finished/u),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    await user.click(button("View"));
    expect(await screen.findByText("What matters most")).toBeInTheDocument();
    await leave(user, "Your attempts");

    // A new attempt starts over, and a paused one is finished from the list.
    await begin(user, THERE);
    expect(marked()).toBe(FIRST);
    await write(user, ["Otra."]);
    await leave(user, "Pause");
    await user.click(button("Finish"));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    });
    expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(2);

    // An attempt is deleted for good, once the learner has said so twice.
    const [latest] = screen.getAllByRole("button", {
      name: "Delete this attempt",
    });
    await user.click(latest ?? document.body);
    expect(
      screen.getByText("Delete this attempt and everything you wrote in it?"),
    ).toBeInTheDocument();
    await user.click(button("Cancel"));
    expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(2);
    await user.click(
      screen.getAllByRole("button", { name: "Delete this attempt" })[0] ??
        document.body,
    );
    await user.click(button("Delete"));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(1);
    });
    expect(
      screen.getByText(/1 of 4 paragraphs · Finished/u),
    ).toBeInTheDocument();
  });

  test("a paragraph goes back into English once it is whole the other way", async () => {
    const user = await open();
    await begin(user, THERE);
    await write(user, ["Uno.", "Dos;", "Tres."]);
    await leave(user, "Pause");

    await begin(user, BACK);
    expect(screen.getByText("Spanish → English")).toBeInTheDocument();
    // The version in the learner's language is what is translated, and the
    // author's words are nowhere while it is.
    expect(marked()).toBe("El chico despertó antes que las sirenas.");
    expect(screen.queryByText(new RegExp(FIRST, "u"))).toBeNull();

    await write(user, ["One.", "Two;", "Three."]);
    expect(
      await screen.findByText("That's every paragraph you had translated"),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText(/^Score: /u)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(FIRST, "u"))).toBeNull();

    // Read once finished, it is beside what the author wrote.
    await user.click(button("Finish session"));
    expect(await screen.findByText("What matters most")).toBeInTheDocument();
    expect(
      screen.getByText(/The boy woke before the sirens did\. He lay still/u),
    ).toBeInTheDocument();
    expect(screen.getByText(/→ there were/u)).toBeInTheDocument();
  });
});
