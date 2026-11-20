import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { useMockBackend } from "@/test/mockBackend";
import { VerbFormTag } from "./VerbFormTag";

describe("VerbFormTag", () => {
  useMockBackend();

  test("a verb's form is outlined in the colour of a verb, a detail of it", () => {
    render(<VerbFormTag form="past" />);
    const tag = document.querySelector("[data-verb-form]");
    expect(tag?.textContent).toBe("past simple");
    expect(tag?.className).toContain("text-verb");
    expect(tag?.className).toContain("ring-verb");
  });
});
