import { describe, expect, mock, test } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMockBackend } from "@/test/mockBackend";
import { Composer } from "./Composer";

function composer(onSend: () => Promise<boolean>): void {
  render(
    <Composer
      sessionId="s1"
      turnWordGoal={40}
      scaffolds={[]}
      voice={false}
      disabled={false}
      onSend={onSend}
    />,
  );
}

describe("Composer", () => {
  useMockBackend();

  test("empties the box as soon as a turn is sent", async () => {
    const user = userEvent.setup();
    // The partner never answers: the box must not wait for the reply.
    const { promise } = Promise.withResolvers<boolean>();
    composer(() => promise);

    const box = screen.getByLabelText("Your answer");
    await user.type(box, "I finished a big report{Enter}");

    expect(box).toHaveValue("");
  });

  test("gives the text back when the turn fails to send", async () => {
    const user = userEvent.setup();
    const onSend = mock(() => Promise.resolve(false));
    composer(onSend);

    const box = screen.getByLabelText("Your answer");
    await user.type(box, "I finished a big report{Enter}");

    expect(onSend).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(box).toHaveValue("I finished a big report");
    });
  });
});
