import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UserEvent } from "@testing-library/user-event";
import { MotionGlobalConfig } from "motion/react";
import * as ipc from "@/lib/ipc";
import { startDrill } from "@/lib/ipc";
import { useMockBackend } from "@/test/mockBackend";
import { DrillRunner } from "./DrillRunner";
import { Practice } from "./Practice";

describe("DrillRunner", () => {
  useMockBackend();

  test("a miss explains, then adds one similar item to try again", async () => {
    const user = userEvent.setup();
    const drill = await startDrill(null, "transformation");
    render(<DrillRunner drill={drill} onAgain={mock()} onClose={mock()} />);

    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(
      screen.getByText(
        "You're practising: Present perfect vs past simple with finished time",
      ),
    ).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Your answer"),
      "I visited Rome three times",
    );
    await user.click(screen.getByRole("button", { name: "Check" }));

    expect(await screen.findByText("Not quite.")).toBeInTheDocument();
    expect(
      screen.getByText("Expected: I've visited Rome three times."),
    ).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try a similar one" }));
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Your answer"),
      "I sent it two hours ago.",
    );
    await user.keyboard("{Enter}");
    // Right only on the second chance: it says so.
    expect(
      await screen.findByText("Right, on the second try."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Try a similar one" }),
    ).toBeNull();
  });

  test("spot the error: pick the sentence, rewrite it, then see the summary", async () => {
    const user = userEvent.setup();
    const drill = await startDrill(null, "spotError");
    render(<DrillRunner drill={drill} onAgain={mock()} onClose={mock()} />);

    await user.click(
      screen.getByRole("button", { name: "I have seen that film last night." }),
    );
    const field = screen.getByLabelText("Now write it correctly");
    expect(field).toHaveValue("I have seen that film last night.");
    await user.clear(field);
    await user.type(field, "I saw that film last night.");
    await user.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Right.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Next/u }));

    // An interleaved item says that the pattern changed.
    expect(
      screen.getByText(
        "You're practising: make vs do with nouns (make an effort, do a favour)",
      ),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "I need to do a decision today." }),
    );
    await user.clear(screen.getByLabelText("Now write it correctly"));
    await user.type(
      screen.getByLabelText("Now write it correctly"),
      "I need to make a decision today.",
    );
    await user.click(screen.getByRole("button", { name: "Check" }));
    await screen.findByText("Right.");
    await user.click(screen.getByRole("button", { name: /Next/u }));

    expect(
      screen.getByRole("heading", { name: "Round done" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 of 2 right")).toBeInTheDocument();
  });
});

describe("from one item to the next, with animation on", () => {
  useMockBackend();

  const nativeAnimate = Element.prototype.animate;

  // As in `motion.test.tsx`: real exits, on motion's own frame loop.
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

  /** The field that takes an answer: never one on its way out. */
  function ask(): HTMLTextAreaElement {
    const fields = screen.getAllByRole<HTMLTextAreaElement>("textbox");
    const live = fields.find((each) => each.closest("[inert]") === null);
    if (live === undefined) {
      throw new Error("No field takes an answer.");
    }
    return live;
  }

  function leaving(): Element | null {
    return document.querySelector("[inert]");
  }

  /**
   * Everything on the screen has finished coming in: what is removed during
   * its entry never finishes its exit in happy-dom, unlike in a browser.
   */
  function settled(): Promise<void> {
    return waitFor(() => {
      const moving = [
        ...document.querySelectorAll<HTMLElement>('[style*="opacity"]'),
      ].filter((each) => each.style.opacity !== "1");
      expect(moving).toHaveLength(0);
    });
  }

  /** The first item of a drill on the screen, done coming in. */
  async function drilling(): Promise<UserEvent> {
    const drill = await startDrill(null, "transformation");
    render(<DrillRunner drill={drill} onAgain={mock()} onClose={mock()} />);
    await settled();
    return userEvent.setup({ delay: null });
  }

  /** Answers the item on the screen with Enter and goes on. */
  async function through(user: UserEvent, text: string): Promise<void> {
    await user.keyboard(`${text}{Enter}`);
    const onward = await screen.findByRole("button", {
      name: /similar|Next/u,
    });
    await settled();
    await user.click(onward);
  }

  test("Enter during an exit answers the new item and never the old one twice", async () => {
    const sent = spyOn(ipc, "answerDrill");
    const user = await drilling();

    await through(user, "first");
    expect(leaving() === null).toBe(false);
    await user.keyboard("second{Enter}");
    expect(leaving() === null).toBe(false);

    await waitFor(() => {
      expect(sent).toHaveBeenCalledTimes(2);
    });
    expect(sent.mock.calls.map((call) => call[2])).toEqual(["first", "second"]);
    const [first, second] = sent.mock.calls.map((call) => call[1]);
    expect(second).not.toBe(first);
    await waitFor(() => {
      expect(leaving() === null).toBe(true);
    });
    expect(sent).toHaveBeenCalledTimes(2);
  });

  test("Again starts the new round, though the last is still leaving", async () => {
    render(
      <Practice
        patternId={null}
        format="transformation"
        autostart
        navigate={mock()}
      />,
    );
    await screen.findByRole("textbox");
    await settled();
    const user = userEvent.setup({ delay: null });

    while (screen.queryByRole("heading", { name: "Round done" }) === null) {
      await through(user, "wrong");
      await settled();
    }
    await user.click(screen.getByRole("button", { name: "Another round" }));

    await waitFor(() => {
      expect(screen.queryByText("1 of 2")).not.toBeNull();
    });
    expect(ask()).toHaveValue("");
    expect(ask()).toHaveFocus();
    // Happy-dom does not finish this exit; a browser does. Here it is enough
    // that the old round is out of use.
    const old = screen.queryByRole("heading", { name: "Round done" });
    expect(old === null || old.closest("[inert]") !== null).toBe(true);
  });

  test("the next item takes input while the last one leaves", async () => {
    const user = await drilling();
    const first = ask();

    await through(user, "first");

    expect(leaving()).toContainElement(first);
    const next = ask();
    expect(next).not.toBe(first);
    expect(next).toHaveValue("");
    expect(next).toHaveFocus();
    await user.keyboard("y");
    expect(next).toHaveValue("y");
    expect(first).toHaveValue("first");
    expect(next.id).not.toBe(first.id);
    await waitFor(() => {
      expect(leaving() === null).toBe(true);
    });
    expect(next).toHaveFocus();
  });
});
