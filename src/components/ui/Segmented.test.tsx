import { expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Segmented } from "./Segmented";

const CHOICES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

/** The pills on the screen, and the label each one sits in. */
function pills(): Element[] {
  return [...document.querySelectorAll("[data-pill]")];
}

test("one option is marked, and the pill sits in it", () => {
  render(
    <Segmented
      legend="Theme"
      choices={CHOICES}
      value="light"
      onChange={mock()}
    />,
  );

  expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "System" })).not.toBeChecked();
  expect(screen.getByRole("radio", { name: "Dark" })).not.toBeChecked();
  expect(pills()).toHaveLength(1);
  expect(pills()[0]?.closest("label")).toHaveTextContent("Light");
});

test("choosing another hands the pill over and tells the caller", async () => {
  const user = userEvent.setup();
  const onChange = mock();
  const { rerender } = render(
    <Segmented
      legend="Theme"
      choices={CHOICES}
      value="light"
      onChange={onChange}
    />,
  );

  await user.click(screen.getByRole("radio", { name: "Dark" }));
  expect(onChange).toHaveBeenCalledWith("dark");

  rerender(
    <Segmented
      legend="Theme"
      choices={CHOICES}
      value="dark"
      onChange={onChange}
    />,
  );
  expect(pills()).toHaveLength(1);
  expect(pills()[0]?.closest("label")).toHaveTextContent("Dark");
});
