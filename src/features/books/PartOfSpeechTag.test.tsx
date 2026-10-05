import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMockBackend } from "@/test/mockBackend";
import { PartOfSpeechTag } from "./PartOfSpeechTag";

describe("PartOfSpeechTag", () => {
  useMockBackend();

  test("says in a few words what its kind of word is, on hover", async () => {
    const user = userEvent.setup();
    render(<PartOfSpeechTag kind="adverb" />);
    const tag = screen.getByRole("button", { name: "adverb" });
    // Nothing until it is asked for.
    expect(screen.queryByRole("tooltip")).toBeNull();

    await user.hover(tag);
    const hint = screen.getByRole("tooltip");
    expect(hint.textContent).toBe("Says how, when or where.");
    expect(tag.getAttribute("aria-describedby")).toBe(hint.id);

    await user.unhover(tag);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  test("says it on focus too, and Escape puts it away", async () => {
    const user = userEvent.setup();
    render(<PartOfSpeechTag kind="phrasalVerb" />);

    await user.tab();
    expect(screen.getByRole("button", { name: "phrasal verb" })).toHaveFocus();
    expect(screen.getByRole("tooltip").textContent).toBe(
      "Verb + particle, with a meaning of its own.",
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();

    // A click, or a tap, asks again; leaving puts it away.
    await user.click(screen.getByRole("button", { name: "phrasal verb" }));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  test("a word of no kind worth naming has no tag", () => {
    const { container } = render(
      <>
        <PartOfSpeechTag kind={null} />
        <PartOfSpeechTag kind="other" />
      </>,
    );
    expect(container.textContent).toBe("");
  });
});
