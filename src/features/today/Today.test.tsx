import { beforeEach, describe, expect, mock, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { chapterOn } from "@/features/books/currentChapter";
import type { Current } from "@/features/books/currentChapter";
import { i18n } from "@/lib/i18n/i18n";
import { homeState, listBooks, structuresState } from "@/lib/ipc";
import { seedMockReadiness } from "@/lib/ipcMockChapters";
import { setMockHome } from "@/lib/ipcMockHome";
import { useMockBackend } from "@/test/mockBackend";
import { Today } from "./Today";

async function current(): Promise<Current> {
  const on = chapterOn(await listBooks(), null);
  if (on === null) {
    throw new Error("The mock shelf has no chapter.");
  }
  return on;
}

function review(): HTMLElement {
  return screen.getByRole("region", { name: "Daily review" });
}

describe("Today", () => {
  useMockBackend();

  beforeEach(() => {
    setMockHome({ dueWords: 7, dueReviews: 2 });
  });

  test("the words say how they split by effort", async () => {
    seedMockReadiness();
    render(<Today current={await current()} navigate={mock()} />);

    const queue = within(
      await screen.findByRole("region", { name: "Daily review" }),
    );
    expect(await queue.findByText(/^\d+ stubborn$/u)).toBeInTheDocument();
    expect(queue.getByText(/^\d+ hard-won$/u)).toBeInTheDocument();
    expect(queue.getByText(/^\d+ first try$/u)).toBeInTheDocument();
    expect(queue.getByRole("img", { name: "Much effort" })).toBeInTheDocument();
  });

  test("the daily review is one queue: every kind, what comes back and where it comes from", async () => {
    render(<Today current={await current()} navigate={mock()} />);

    const queue = within(
      await screen.findByRole("region", { name: "Daily review" }),
    );
    expect(queue.getByText(/9 things come back today/u)).toBeInTheDocument();
    expect(
      queue.getByRole("button", { name: "Words: 7 words come back" }),
    ).toBeEnabled();
    expect(
      queue.getByRole("button", { name: "Drills: 2 patterns come back" }),
    ).toBeEnabled();
    // Nothing of a kind today: it is listed all the same, and cannot start.
    expect(
      queue.getByRole("button", { name: "Structures: Nothing today" }),
    ).toBeDisabled();
    expect(
      queue.getByText("From your books and from what you asked in your chats"),
    ).toBeInTheDocument();
    expect(
      queue.getByText("Patterns that keep coming up when you talk"),
    ).toBeInTheDocument();
  });

  test("the review starts with the first kind that has something, and each row starts its own", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Today current={await current()} navigate={navigate} />);
    await screen.findByRole("region", { name: "Daily review" });

    await user.click(
      within(review()).getByRole("button", { name: "Start with Words" }),
    );
    expect(navigate).toHaveBeenLastCalledWith({
      name: "recall",
      running: null,
    });
    await user.click(
      within(review()).getByRole("button", { name: /^Drills:/u }),
    );
    expect(navigate).toHaveBeenLastCalledWith({
      name: "practice",
      patternId: null,
      format: null,
    });
  });

  test("with the words done, the review goes on with the drills", async () => {
    setMockHome({ dueWords: 0, dueReviews: 2 });
    const user = userEvent.setup();
    const navigate = mock();
    render(<Today current={await current()} navigate={navigate} />);
    await screen.findByRole("region", { name: "Daily review" });

    await user.click(
      within(review()).getByRole("button", { name: "Start with Drills" }),
    );
    expect(navigate).toHaveBeenLastCalledWith({
      name: "practice",
      patternId: null,
      format: null,
    });
  });

  test("with nothing back today it still offers an extra review", async () => {
    setMockHome({ dueWords: 0, dueReviews: 0 });
    const state = await structuresState();
    const user = userEvent.setup();
    const navigate = mock();
    render(<Today current={await current()} navigate={navigate} />);
    await screen.findByRole("region", { name: "Daily review" });

    // The mock has no structure due: nothing at all comes back.
    expect(state.structures.filter((each) => each.due)).toHaveLength(0);
    expect(
      within(review()).getByText("Nothing comes back today."),
    ).toBeInTheDocument();
    await user.click(
      within(review()).getByRole("button", {
        name: "Extra review: a round of drills",
      }),
    );
    expect(navigate).toHaveBeenLastCalledWith({
      name: "practice",
      patternId: null,
      format: null,
    });
  });

  test("a tower of the relief starts its kind, as its row does", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Today current={await current()} navigate={navigate} />);

    const relief = await screen.findByRole("img", {
      name: /^The day as 3D blocks/u,
    });
    const tower = [...relief.querySelectorAll("g.cursor-pointer")].find(
      (each) => each.textContent === "7",
    );
    if (tower === undefined) throw new Error("no tower for the words");
    await user.click(tower);

    expect(navigate).toHaveBeenLastCalledWith({
      name: "recall",
      running: null,
    });
  });

  test("it goes on in the book where the chapter left off, and in the chat on today's topic", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    const on = await current();
    const home = await homeState();
    render(<Today current={on} navigate={navigate} />);

    // The mock's first chapter has words still to learn: they are next.
    await user.click(
      await screen.findByRole("button", { name: "Open the chapter" }),
    );
    expect(navigate).toHaveBeenLastCalledWith({ name: "book", tab: "words" });

    const [topic] = home.suggestedTopics;
    if (topic === undefined) throw new Error("the mock suggests no topic");
    expect(screen.getAllByText(topic).length).toBeGreaterThan(0);
    await user.click(
      screen.getByRole("button", { name: "Start conversation" }),
    );
    expect(navigate).toHaveBeenLastCalledWith({
      name: "conversation",
      setup: expect.objectContaining({ topic }),
    });
  });

  test("without a book it leads to the library to add one", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Today current={null} navigate={navigate} />);

    await user.click(await screen.findByRole("button", { name: "Add a book" }));
    expect(navigate).toHaveBeenLastCalledWith({ name: "books", bookId: null });
  });

  test("is in Spanish too", async () => {
    await i18n.changeLanguage("es");
    render(<Today current={await current()} navigate={mock()} />);

    const queue = within(
      await screen.findByRole("region", { name: "Repaso diario" }),
    );
    expect(
      queue.getByRole("button", { name: "Empezar por Palabras" }),
    ).toBeVisible();
    expect(
      queue.getByRole("button", { name: "Palabras: Vuelven 7 palabras" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Abrir el capítulo" }),
    ).toBeVisible();
  });
});
