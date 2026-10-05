import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import type { Route } from "@/app/routes";
import { showsNav } from "@/app/routes";
import { i18n } from "@/lib/i18n/i18n";
import { seedMockReadiness } from "@/lib/ipcMockChapters";
import { useMockBackend } from "@/test/mockBackend";
import { BooksScreen } from "./BooksScreen";

const REFRESH = "Quick refresh before reading";

/** The books section on the chapter that is ready, as the app holds it. */
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
    <>
      {showsNav(route) && <nav aria-label="Sections" />}
      <BooksScreen
        nativeLang="es"
        bookId={route.bookId}
        chapterId={route.chapterId ?? null}
        practising={route.practising === true}
        refresh={route.refresh === true}
        navigate={setRoute}
      />
    </>
  );
}

function prompt(): string {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

/** The ready chapter of the mock, with its refresh just started. */
async function refresh(start = REFRESH): Promise<UserEvent> {
  seedMockReadiness();
  const user = userEvent.setup();
  render(<Shelf />);
  await user.click(await screen.findByRole("button", { name: start }));
  return user;
}

/** Types an answer, checks it with Enter and goes on with Enter. */
async function answer(
  user: UserEvent,
  text: string,
  verdict: string,
): Promise<void> {
  await user.keyboard(`${text}{Enter}`);
  expect(await screen.findByText(verdict)).toBeInTheDocument();
  await user.keyboard("{Enter}");
}

/** The right answer to each prompt of the two words missed below. */
const RIGHT: Record<string, string> = {
  peep: "asomarse",
  marmalade: "mermelada",
  "asomarse, echar un vistazo": "peep",
  mermelada: "marmalade",
};

describe("the quick refresh before reading", () => {
  useMockBackend();

  test("asks each done word once and says how many are still solid", async () => {
    const user = await refresh();

    // The whole window, the keyboard in the answer, English → native.
    const field = await screen.findByLabelText("Your translation");
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(field).toHaveFocus();
    expect(screen.getByText("English → Spanish")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Leave the refresh" }),
    ).toBeInTheDocument();
    // Its words are done: there is nothing to say "I know this" to.
    expect(screen.queryByRole("button", { name: "I know this" })).toBeNull();

    // Most frequent first; "hedge" is known and is not asked.
    const asked = [];
    for (const right of ["El Chaleco", "mermelada", "asomarse"]) {
      asked.push(prompt());
      await answer(user, right, "Right.");
    }
    expect(asked).toEqual(["waistcoat", "marmalade", "peep"]);

    expect(
      await screen.findByRole("heading", { name: "Refreshed" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 words still solid")).toBeInTheDocument();
    expect(
      screen.getByText("Nothing slipped. Enjoy the chapter."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Practice them" })).toBeNull();
    const back = screen.getByRole("button", { name: "Back to the chapter" });
    expect(back).toHaveFocus();

    // Nothing changed: the chapter is as ready as it was.
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Ready to read")).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Done" })).toHaveLength(3);
  });

  test("the bar at the top goes forward a word at a time, right or wrong, to the summary", async () => {
    const user = await refresh();
    await screen.findByLabelText("Your translation");
    const bar = (): number =>
      Number(
        screen
          .getByRole("progressbar", { name: "Session progress" })
          .getAttribute("aria-valuenow"),
      );
    expect(bar()).toBe(0);

    // The verdict does not move it; going on does.
    await user.keyboard("chaleco{Enter}");
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    expect(bar()).toBe(0);
    await user.keyboard("{Enter}");
    expect(bar()).toBe(33);

    // Left and gone on with, it is where it was.
    await user.click(screen.getByRole("button", { name: "Leave the refresh" }));
    await user.click(await screen.findByRole("button", { name: REFRESH }));
    await screen.findByLabelText("Your translation");
    expect(bar()).toBe(33);

    // A missed word is a word asked: the bar does not go back.
    await answer(user, "jalea", "Not quite.");
    expect(bar()).toBe(66);
    await answer(user, "asomarse", "Right.");
    expect(
      await screen.findByRole("heading", { name: "Refreshed" }),
    ).toBeInTheDocument();
    expect(bar()).toBe(100);
  });

  test("a miss sends the word back to practice, and the summary counts both", async () => {
    const user = await refresh();
    await screen.findByLabelText("Your translation");

    await answer(user, "chaleco", "Right.");
    // A miss stands: the refresh does not ask Claude.
    await user.keyboard("jalea{Enter}");
    expect(await screen.findByText("Not quite.")).toBeInTheDocument();
    expect(screen.getByText("Accepted: mermelada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I was right" })).toBeNull();
    await user.keyboard("{Enter}");
    expect(prompt()).toBe("peep");
    await user.click(screen.getByRole("button", { name: "I don't know" }));
    expect(await screen.findByText("Here it is.")).toBeInTheDocument();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("heading", { name: "Refreshed" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 word still solid")).toBeInTheDocument();
    expect(screen.getByText("2 words back in practice")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Back to the chapter" }),
    ).toBeInTheDocument();

    // Straight on to practising them: two right answers in a row each,
    // both ways, and the chapter is ready again.
    expect(screen.getByRole("button", { name: "Practice them" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("button", { name: "Start" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await screen.findByLabelText("Your translation");
    expect(
      screen.getByRole("button", { name: "Leave practice" }),
    ).toBeInTheDocument();
    const asked = [];
    while (
      screen.queryByRole("heading", { name: "That's it for now" }) === null
    ) {
      const shown = prompt();
      asked.push(shown);
      await answer(user, RIGHT[shown] ?? "", "Right.");
    }
    expect(asked).toHaveLength(8);
    for (const shown of Object.keys(RIGHT)) {
      expect(asked.filter((each) => each === shown)).toHaveLength(2);
    }
    expect(screen.getByText("2 words done")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("Ready to read")).toBeInTheDocument();
  });

  test("going back from a summary with misses shows a chapter to practise", async () => {
    const user = await refresh();
    await screen.findByLabelText("Your translation");
    await answer(user, "chaqueta", "Not quite.");
    await answer(user, "mermelada", "Right.");
    await answer(user, "asomarse", "Right.");

    expect(await screen.findByText("2 words still solid")).toBeInTheDocument();
    expect(screen.getByText("1 word back in practice")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Back to the chapter" }),
    );
    expect(
      await screen.findByRole("button", { name: "Practice" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 word to learn")).toBeInTheDocument();
    expect(screen.queryByText("Ready to read")).toBeNull();
    expect(screen.queryByRole("button", { name: REFRESH })).toBeNull();
  });

  test("leaving halfway keeps the answers, and the next refresh goes on", async () => {
    const user = await refresh();
    await screen.findByLabelText("Your translation");
    await answer(user, "chaleco", "Right.");
    expect(prompt()).toBe("marmalade");

    await user.click(screen.getByRole("button", { name: "Leave the refresh" }));
    await user.click(await screen.findByRole("button", { name: REFRESH }));
    await screen.findByLabelText("Your translation");
    expect(prompt()).toBe("marmalade");
    await answer(user, "mermelada", "Right.");
    await answer(user, "asomarse", "Right.");
    expect(await screen.findByText("3 words still solid")).toBeInTheDocument();

    // That pass is over: the next one starts from the first word.
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("button", { name: REFRESH }));
    await screen.findByLabelText("Your translation");
    expect(prompt()).toBe("waistcoat");
  });

  test("is played to its summary in Spanish too", async () => {
    await i18n.changeLanguage("es");
    const user = await refresh("Repaso rápido antes de leer");
    await screen.findByLabelText("Tu traducción");
    expect(
      screen.getByRole("button", { name: "Salir del repaso" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Progreso de la sesión" }),
    ).toHaveAttribute("aria-valuenow", "0");

    await answer(user, "chaleco", "Correcto.");
    await answer(user, "jalea", "Esta vez no.");
    await answer(user, "asomarse", "Correcto.");

    expect(
      await screen.findByRole("heading", { name: "Repaso hecho" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 palabras siguen firmes")).toBeInTheDocument();
    expect(
      screen.getByText("1 palabra vuelve a la práctica"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Practicarla" })).toHaveFocus();
    await user.click(
      screen.getByRole("button", { name: "Volver al capítulo" }),
    );
    expect(
      await screen.findByRole("button", { name: "Practicar" }),
    ).toBeInTheDocument();
  });
});
