import { describe, expect, test } from "bun:test";

import { hideStarters, splitStarters } from "./starters.ts";

describe("splitStarters", () => {
  test("separates the reply from its starters", () => {
    expect(
      splitStarters(
        "Nice! Do you prefer tea or coffee?\n<starters>I prefer… | I usually drink…|I don't like…</starters>",
      ),
    ).toEqual({
      text: "Nice! Do you prefer tea or coffee?",
      starters: ["I prefer…", "I usually drink…", "I don't like…"],
    });
  });

  test("leaves a reply without a tail as it is", () => {
    expect(splitStarters("  Oh really?  ")).toEqual({
      text: "Oh really?",
      starters: [],
    });
  });

  test("reads a tail that was never closed and drops empty entries", () => {
    expect(
      splitStarters("Where did you go?\n<starters>I went to…||\n"),
    ).toEqual({ text: "Where did you go?", starters: ["I went to…"] });
    expect(splitStarters("Where did you go? <starters></starters>")).toEqual({
      text: "Where did you go?",
      starters: [],
    });
  });
});

function streamed(deltas: string[]): string {
  const seen: string[] = [];
  const filter = hideStarters((text) => seen.push(text));
  for (const delta of deltas) {
    filter.push(delta);
  }
  filter.finish();
  return seen.join("");
}

describe("hideStarters", () => {
  test("passes a reply without a tail through, less its trailing space", () => {
    expect(streamed(["Oh ", "really? ", "What next?\n"])).toBe(
      "Oh really? What next?",
    );
  });

  test("never streams the tail, even when the tag is split across deltas", () => {
    expect(
      streamed([
        "Tea or coffee?",
        "\n<star",
        "ters>I prefer…|I ",
        "like…</starters>",
      ]),
    ).toBe("Tea or coffee?");
    expect(streamed(["Tea or coffee?\n<starters>I prefer…</starters>"])).toBe(
      "Tea or coffee?",
    );
  });

  test("lets through text that only looked like the start of the tag", () => {
    expect(streamed(["I <", "3 tea. <st", "rong> yes"])).toBe(
      "I <3 tea. <strong> yes",
    );
    expect(streamed(["a <"])).toBe("a <");
  });

  test("streams exactly the text splitStarters keeps", () => {
    const raw = "Nice!  Where did you go?\n\n<starters>I went to…</starters>\n";
    for (let size = 1; size <= raw.length; size += 1) {
      const deltas: string[] = [];
      for (let at = 0; at < raw.length; at += size) {
        deltas.push(raw.slice(at, at + size));
      }
      expect(streamed(deltas)).toBe(splitStarters(raw).text);
    }
  });
});
