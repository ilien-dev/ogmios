import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { Learned } from "./TranslateRows";

describe("Learned", () => {
  test("underlines the learned words and leaves the rest plain text", () => {
    const { container } = render(
      <p>
        <Learned
          sentences={[
            [
              { text: "She ", marked: false },
              { text: "peeped", marked: true },
              { text: " over the ", marked: false },
              { text: "hedge", marked: true },
              { text: ".", marked: false },
            ],
            [{ text: "Nothing stirred.", marked: false }],
          ]}
        />
      </p>,
    );
    expect(container.textContent).toBe(
      "She peeped over the hedge. Nothing stirred.",
    );
    const learned = [...container.querySelectorAll("[data-learned]")];
    expect(learned.map((word) => word.textContent)).toEqual([
      "peeped",
      "hedge",
    ]);
    // What is not learned is no element of its own.
    expect(container.querySelectorAll("span")).toHaveLength(2);
  });
});
