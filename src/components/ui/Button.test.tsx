import { expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Button } from "./Button";

test("moves on hover and press: no transition-colors in the way of them", () => {
  render(<Button>Go</Button>);
  const button = screen.getByRole("button", { name: "Go" });

  expect(button).toHaveClass("transition-control");
  expect(button).not.toHaveClass("transition-colors");
});
