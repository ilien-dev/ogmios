import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionGlobalConfig } from "motion/react";
import type { BookWord } from "@shared/domain";
import { useMockBackend } from "@/test/mockBackend";
import { WordList } from "./WordList";

const nativeAnimate = Element.prototype.animate;

// As in the motion primitives' tests: motion drives the page by its own frame
// loop, which happy-dom can run, and its animations are really on.
beforeEach(() => {
  MotionGlobalConfig.skipAnimations = false;
  Reflect.deleteProperty(Element.prototype, "animate");
  spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  MotionGlobalConfig.skipAnimations = true;
  Element.prototype.animate = nativeAnimate;
  mock.restore();
});

// A real exit runs on happy-dom's frame loop, which is slow with a table's worth of motion.
const SLOW = { timeout: 3000 };

function word(lemma: string, known = false): BookWord {
  return {
    id: lemma,
    lemma,
    partOfSpeech: null,
    translations: [`${lemma}-es`],
    count: 1,
    done: false,
    strength: null,
    half: null,
    known,
    sorted: false,
  };
}

function Chapter(): ReactNode {
  const [words, setWords] = useState([word("ant"), word("bee"), word("cat")]);
  return (
    <WordList
      words={words}
      onKnown={(changed, known) => {
        setWords((now) =>
          now.map((each) =>
            each.id === changed.id ? { ...each, known } : each,
          ),
        );
      }}
    />
  );
}

/** The cascade has come in: nothing is left half way. */
async function arrived(): Promise<void> {
  await waitFor(() => {
    for (const row of screen.getAllByRole("row")) {
      expect(row.style.opacity).not.toBe("0");
    }
  }, SLOW);
}

function lemmas(): Array<string | null> {
  return within(screen.getByRole("table"))
    .getAllByRole("rowheader")
    .map((cell) => cell.textContent);
}

describe("WordList motion", () => {
  useMockBackend();

  test("removing a word lets the rest close the gap", async () => {
    render(<Chapter />);
    expect(lemmas()).toEqual(["ant", "bee", "cat"]);

    await arrived();
    const row = screen.getByText("bee").closest("tr");
    await userEvent.click(
      screen.getByRole("button", { name: "I know this: bee" }),
    );
    // The row stays for its exit, and cannot be used meanwhile.
    expect(row).toHaveAttribute("inert");
    await waitForElementToBeRemoved(row, SLOW);
    expect(lemmas()).toEqual(["ant", "cat"]);
    expect(screen.getByText("1 word you already know")).toBeInTheDocument();
  });

  test("taking a known word back brings its row in again", async () => {
    render(<Chapter />);
    await arrived();
    const row = screen.getByText("ant").closest("tr");
    await userEvent.click(
      screen.getByRole("button", { name: "I know this: ant" }),
    );
    await waitForElementToBeRemoved(row, SLOW);
    await userEvent.click(screen.getByText("1 word you already know"));
    await userEvent.click(screen.getByRole("button", { name: "Undo: ant" }));
    expect(
      await screen.findByRole("rowheader", { name: /^ant/u }),
    ).toBeVisible();
    expect(lemmas()).toContain("ant");
  });
});
