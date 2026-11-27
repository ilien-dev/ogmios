import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tooltip } from "./Tooltip";

describe("Tooltip", () => {
  test("floats over the page, so a box that clips its content cannot hide it", async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="box" className="overflow-hidden">
        <Tooltip hint="Its past and its participle end in -ed.">
          regular
        </Tooltip>
      </div>,
    );
    await user.hover(screen.getByRole("button", { name: "regular" }));
    const hint = screen.getByRole("tooltip");
    expect(screen.getByTestId("box").contains(hint)).toBe(false);
    expect(hint.parentElement).toBe(document.body);
    expect(hint.className).toContain("fixed");
  });
});
