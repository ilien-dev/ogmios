import { describe, expect, test } from "bun:test";
import { en } from "./en";
import { es } from "./es";

function leaves(tree: object, prefix = ""): Map<string, string> {
  const found: Map<string, string> = new Map();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "string") {
      found.set(path, value);
    } else {
      for (const [inner, text] of leaves(value as object, path)) {
        found.set(inner, text);
      }
    }
  }
  return found;
}

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{\{(\w+)\}\}/gu)].map((match) => match[1] ?? "").sort();

describe("interface strings", () => {
  const english = leaves(en);
  const spanish = leaves(es);

  test("English and Spanish have the same keys", () => {
    expect([...spanish.keys()].sort()).toEqual([...english.keys()].sort());
  });

  test("no string is empty", () => {
    for (const [key, text] of [...english, ...spanish]) {
      expect({ key, empty: text.trim() === "" }).toEqual({ key, empty: false });
    }
  });

  test("each translation keeps the same placeholders", () => {
    for (const [key, text] of english) {
      expect({ key, names: placeholders(spanish.get(key) ?? "") }).toEqual({
        key,
        names: placeholders(text),
      });
    }
  });
});
