import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChoiceGroup } from "./ChoiceGroup";

describe("ChoiceGroup", () => {
  test("a choice with nothing behind it shows, but cannot be chosen", async () => {
    const user = userEvent.setup();
    const onChange = mock();
    render(
      <ChoiceGroup
        legend="Which"
        value="a"
        onChange={onChange}
        choices={[
          { value: "a", label: "First", mark: <span>mark</span> },
          { value: "b", label: "Second", disabled: true },
        ]}
      />,
    );
    const second = screen.getByRole("radio", { name: "Second" });
    expect(second).toBeDisabled();
    await user.click(screen.getByText("Second"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("mark")).toBeInTheDocument();
  });
});
