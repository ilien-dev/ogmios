import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { i18n } from "@/lib/i18n/i18n";
import { setMockLatency } from "@/lib/ipcMock";
import { seedMockLongChapter } from "@/lib/ipcMockChapters";
import { holdMockDisputes, setMockDisputesFail } from "@/lib/ipcMockPractice";
import { setMockWordKnown } from "@/lib/ipcMockWords";
import { useMockBackend } from "@/test/mockBackend";
import { SittingScreen } from "./SittingScreen";

const WAS_RIGHT = "I was right";
const UPHELD = "You were right. It counts as correct.";
const EARLIER_UPHELD =
  "Your earlier answer was right after all. It counts as correct.";
/** What the mock's judge says of an answer it does not uphold. */
const REASON = "«cueva» no es lo que esta palabra quiere decir en su frase.";

/** The right answer to each prompt of the mock's chapters, either way. */
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
  bank: "orilla",
  "orilla, ribera": "bank",
  daisy: "margarita",
  margarita: "daisy",
  cupboard: "armario",
  "armario, alacena": "cupboard",
  shelf: "estante",
  "estante, repisa": "shelf",
};

function prompt(): string {
  return screen.getByRole("heading", { level: 1 }).textContent;
}

/** A sitting on the mock's prepared chapter, at its first word. */
async function sit(): Promise<UserEvent> {
  const user = userEvent.setup();
  render(
    <SittingScreen chapterId="book-alice-0" nativeLang="es" onClose={mock()} />,
  );
  await user.click(await screen.findByRole("button", { name: "Start" }));
  await screen.findByLabelText("Your translation");
  expect(prompt()).toBe("rabbit hole");
  return user;
}

/**
 * A session of ten words on the chapter that has twelve, at its first word:
 * its summary offers "Continue", and the session after it has the last two.
 */
async function sitLong(): Promise<UserEvent> {
  seedMockLongChapter();
  const user = userEvent.setup();
  render(
    <SittingScreen chapterId="book-alice-3" nativeLang="es" onClose={mock()} />,
  );
  await user.click(await screen.findByRole("radio", { name: /^10 words/u }));
  await user.click(screen.getByRole("button", { name: "Start" }));
  await screen.findByLabelText("Your translation");
  expect(prompt()).toBe("rabbit hole");
  return user;
}

/** Types an answer and waits for its verdict. */
async function say(
  user: UserEvent,
  text: string,
  verdict: string,
): Promise<void> {
  await user.keyboard(`${text}{Enter}`);
  expect(await screen.findByText(verdict)).toBeInTheDocument();
}

/** Plays the sitting out with right answers; every prompt it showed. */
async function playOut(user: UserEvent): Promise<string[]> {
  const asked = [];
  while (
    screen.queryByRole("heading", { name: "That's it for now" }) === null
  ) {
    const shown = prompt();
    asked.push(shown);
    await say(user, RIGHT[shown] ?? "", "Right.");
    await user.keyboard("{Enter}");
  }
  return asked;
}

function button(): HTMLElement | null {
  return screen.queryByRole("button", { name: WAS_RIGHT });
}

describe("I was right", () => {
  useMockBackend();

  test("is offered only after a typed miss", async () => {
    const user = await sit();
    expect(button()).toBeNull();

    // Not on "I don't know": there is no answer to stand by.
    await user.click(screen.getByRole("button", { name: "I don't know" }));
    expect(await screen.findByText("Here it is.")).toBeInTheDocument();
    expect(button()).toBeNull();
    await user.keyboard("{Enter}");

    // Not on a right answer.
    expect(prompt()).toBe("tumble");
    await say(user, "rodar", "Right.");
    expect(button()).toBeNull();
    await user.keyboard("{Enter}");

    // On a miss, beside "Next", which keeps the keyboard.
    expect(prompt()).toBe("curtsey");
    await say(user, "saludo", "Not quite.");
    expect(button()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
  });

  test("upheld: the miss is undone and the answer is right from then on", async () => {
    const user = await sit();
    await say(user, "conejera", "Not quite.");

    // From the keyboard: one Tab from "Next", and Enter goes on afterwards.
    await user.tab();
    expect(button()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText(UPHELD)).toBeInTheDocument();
    expect(button()).toBeNull();
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
    await user.keyboard("{Enter}");

    // The answer counted: one more English → native finishes that way, not
    // two. The same answer is accepted without asking again.
    const asked = [];
    while (
      screen.queryByRole("heading", { name: "That's it for now" }) === null
    ) {
      const shown = prompt();
      asked.push(shown);
      const text = shown === "rabbit hole" ? "Conejera" : RIGHT[shown];
      await say(user, text ?? "", "Right.");
      expect(button()).toBeNull();
      await user.keyboard("{Enter}");
    }
    expect(asked.filter((shown) => shown === "rabbit hole")).toHaveLength(1);
    expect(asked.filter((shown) => shown === "madriguera")).toHaveLength(2);
    expect(screen.getByText("8 words done")).toBeInTheDocument();
  });

  test("rejected: the reason is shown and the miss stands", async () => {
    const user = await sit();
    await say(user, "cueva", "Not quite.");
    await user.click(screen.getByRole("button", { name: WAS_RIGHT }));

    expect(await screen.findByText(REASON)).toBeInTheDocument();
    expect(screen.queryByText(UPHELD)).toBeNull();
    // Judged once: there is nothing more to press but "Next".
    expect(button()).toBeNull();
    await user.keyboard("{Enter}");

    // Two right answers in a row: the miss stands and adds nothing.
    const asked = await playOut(user);
    expect(asked.filter((shown) => shown === "rabbit hole")).toHaveLength(2);
  });

  test("the sitting does not wait: a verdict arrives on a later word", async () => {
    const release = holdMockDisputes();
    const user = await sit();
    await say(user, "conejera", "Not quite.");
    await user.click(screen.getByRole("button", { name: WAS_RIGHT }));
    expect(await screen.findByText("Asking Claude…")).toBeInTheDocument();
    expect(button()).toBeNull();

    // The learner goes on, and is halfway through the next answer.
    await user.keyboard("{Enter}");
    expect(prompt()).toBe("tumble");
    await user.keyboard("rod");
    expect(screen.queryByRole("status")).toBeNull();

    release();
    expect(
      await screen.findByText(
        "Your earlier answer was right after all. It counts as correct.",
      ),
    ).toBeInTheDocument();
    // Nothing was taken from them: the word, the text and the keyboard.
    expect(prompt()).toBe("tumble");
    expect(screen.getByLabelText("Your translation")).toHaveValue("rod");
    expect(screen.getByLabelText("Your translation")).toHaveFocus();
    await say(user, "ar", "Right.");
    await user.keyboard("{Enter}");

    // The note stays for the word after it, and then it is gone.
    expect(prompt()).toBe("curtsey");
    expect(screen.getByRole("status")).toBeInTheDocument();
    await say(user, "reverencia", "Right.");
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("status")).toBeNull();

    const asked = await playOut(user);
    expect(asked.filter((shown) => shown === "rabbit hole")).toHaveLength(1);
  });

  test("a rejected verdict on a later word says why, lightly", async () => {
    const release = holdMockDisputes();
    const user = await sit();
    await say(user, "cueva", "Not quite.");
    await user.click(screen.getByRole("button", { name: WAS_RIGHT }));
    await user.keyboard("{Enter}");
    expect(prompt()).toBe("tumble");

    release();
    expect(
      await screen.findByText(`About your earlier answer: ${REASON}`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByLabelText("Your translation")).toHaveFocus();
  });

  test("when Claude cannot be asked the miss stands, and it can be asked again", async () => {
    setMockDisputesFail(true);
    const user = await sit();
    await say(user, "conejera", "Not quite.");
    await user.click(screen.getByRole("button", { name: WAS_RIGHT }));

    expect(
      await screen.findByText(
        "That couldn't be checked just now, so the miss stands.",
      ),
    ).toBeInTheDocument();
    // Quiet: no alert, and the sitting goes on as it was.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    setMockDisputesFail(false);
    await user.click(screen.getByRole("button", { name: WAS_RIGHT }));
    expect(await screen.findByText(UPHELD)).toBeInTheDocument();
    expect(button()).toBeNull();
  });

  test("a verdict that arrives after Continue is shown in the next sitting", async () => {
    const release = holdMockDisputes();
    const user = await sitLong();
    await say(user, "conejera", "Not quite.");
    await user.click(screen.getByRole("button", { name: WAS_RIGHT }));
    await user.keyboard("{Enter}");

    // The sitting is played out and the next one begun, Claude still asked.
    await playOut(user);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Start" }));
    await screen.findByLabelText("Your translation");
    expect(prompt()).toBe("shelf");
    await user.keyboard("esta");
    expect(screen.queryByRole("status")).toBeNull();

    release();
    expect(await screen.findByText(EARLIER_UPHELD)).toBeInTheDocument();
    // The word being answered is left as it was.
    expect(prompt()).toBe("shelf");
    expect(screen.getByLabelText("Your translation")).toHaveValue("esta");
    expect(screen.getByLabelText("Your translation")).toHaveFocus();
    await say(user, "nte", "Right.");
  });

  test("a verdict that arrives while the next sitting starts waits for it", async () => {
    const release = holdMockDisputes();
    const user = await sitLong();
    await say(user, "conejera", "Not quite.");
    await user.click(screen.getByRole("button", { name: WAS_RIGHT }));
    await user.keyboard("{Enter}");
    await playOut(user);

    // The next sitting takes a moment to start; the verdict does not.
    await user.click(screen.getByRole("button", { name: "Continue" }));
    setMockLatency(0.5);
    await user.click(await screen.findByRole("button", { name: "Start" }));
    setMockLatency(0);
    release();
    await screen.findByLabelText("Your translation");
    expect(prompt()).toBe("shelf");
    expect(await screen.findByText(EARLIER_UPHELD)).toBeInTheDocument();
  });

  describe("when the disputed word is on the screen again", () => {
    /**
     * A session of one word, finished English → native and right once the
     * other way, then missed and disputed. Alone, it is asked again at once:
     * the verdict finds the word it is about on the screen, not answered yet.
     */
    async function asked(user: UserEvent): Promise<void> {
      for (const shown of ["rabbit hole", "rabbit hole", "madriguera"]) {
        expect(prompt()).toBe(shown);
        await say(user, RIGHT[shown] ?? "", "Right.");
        await user.keyboard("{Enter}");
      }
      expect(prompt()).toBe("madriguera");
      await say(user, "burrow", "Not quite.");
      await user.click(screen.getByRole("button", { name: WAS_RIGHT }));
      await user.keyboard("{Enter}");
      await screen.findByLabelText("Your translation");
      expect(prompt()).toBe("madriguera");
    }

    /** Leaves "rabbit hole" as the only word of the chapter to practise. */
    function alone(): void {
      for (const lemma of [
        "tumble",
        "curtsey",
        "waistcoat",
        "give up",
        "marmalade",
        "peep",
        "hedge",
      ]) {
        setMockWordKnown(lemma, true);
      }
    }

    test("an upheld verdict that finishes it takes it off the screen", async () => {
      alone();
      const release = holdMockDisputes();
      const user = await sit();
      await asked(user);

      // Upheld, the word owes nothing: answering it would be refused, and
      // with it the session has run out of words.
      release();
      expect(
        await screen.findByRole("heading", { name: "That's it for now" }),
      ).toBeInTheDocument();
      expect(screen.getByText(EARLIER_UPHELD)).toBeInTheDocument();
      expect(screen.getByText("1 word done")).toBeInTheDocument();
      expect(
        screen.getByText("Every word of this chapter is done."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByLabelText("Your translation")).toBeNull();
    });

    test("a verdict that leaves it open leaves it on the screen", async () => {
      alone();
      const release = holdMockDisputes();
      const user = await sit();
      await asked(user);

      setMockDisputesFail(true);
      release();
      expect(
        await screen.findByText(
          "Your earlier answer couldn't be checked, so it stays a miss.",
        ),
      ).toBeInTheDocument();
      expect(prompt()).toBe("madriguera");
      await say(user, "rabbit hole", "Right.");
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  test("both outcomes are in Spanish too", async () => {
    await i18n.changeLanguage("es");
    const user = userEvent.setup();
    render(
      <SittingScreen
        chapterId="book-alice-0"
        nativeLang="es"
        onClose={mock()}
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Empezar" }));
    await screen.findByLabelText("Tu traducción");
    await say(user, "conejera", "Esta vez no.");
    await user.click(screen.getByRole("button", { name: "Estaba bien" }));
    expect(
      await screen.findByText("Tenías razón. Cuenta como correcta."),
    ).toBeInTheDocument();
    await user.keyboard("{Enter}");

    await say(user, "saltar", "Esta vez no.");
    await user.click(screen.getByRole("button", { name: "Estaba bien" }));
    expect(
      await screen.findByText(
        "«saltar» no es lo que esta palabra quiere decir en su frase.",
      ),
    ).toBeInTheDocument();
  });
});
