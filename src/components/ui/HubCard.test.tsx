import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HubCard } from "./HubCard";

describe("HubCard", () => {
  test("is one button, named by its title, that says how things stand", async () => {
    const user = userEvent.setup();
    const onClick = mock();
    render(
      <HubCard
        title="Daily review"
        text="Learned words come back."
        status="8 today"
        due
        onClick={onClick}
      />,
    );

    const card = screen.getByRole("button", { name: /^Daily review/u });
    expect(card).toHaveTextContent("Learned words come back.");
    expect(card).toHaveTextContent("8 today");
    await user.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("a card with nothing to say today has no status", () => {
    render(<HubCard title="Listening" text="Hear it." onClick={mock()} />);

    expect(screen.getByRole("button").children).toHaveLength(2);
  });
});
