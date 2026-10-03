import { describe, expect, test } from "bun:test";
import { segments } from "./segments";

describe("segments", () => {
  test("marks every span where the text has it, in reading order", () => {
    expect(segments("I only play and I work", ["I work", "only"])).toEqual([
      { text: "I ", marked: false },
      { text: "only", marked: true },
      { text: " play and ", marked: false },
      { text: "I work", marked: true },
    ]);
  });

  test("skips a span that is missing, empty or inside another", () => {
    expect(segments("at the same time", ["", "nowhere"])).toEqual([
      { text: "at the same time", marked: false },
    ]);
    expect(segments("at the same time", ["the same", "same time"])).toEqual([
      { text: "at ", marked: false },
      { text: "the same", marked: true },
      { text: " time", marked: false },
    ]);
  });
});
