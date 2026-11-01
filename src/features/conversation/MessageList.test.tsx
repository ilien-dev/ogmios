import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useMockBackend } from "@/test/mockBackend";
import { MessageList } from "./MessageList";
import type { Message } from "./useConversation";

const OPENING: Message = { id: "a1", role: "assistant", text: "Hello there" };
const ANSWER: Message = { id: "u1", role: "user", text: "Hi" };
const REPLY: Message = {
  id: "a2",
  role: "assistant",
  text: "Nice to meet you",
};

function list(messages: Message[], streaming: string | null): ReactNode {
  return (
    <MessageList messages={messages} streaming={streaming} lengthHint="" />
  );
}

describe("MessageList", () => {
  useMockBackend();

  test("a streamed reply keeps one element from first to last chunk", () => {
    const asked = [OPENING, ANSWER];
    const { rerender } = render(list(asked, "Nice"));
    const bubble = screen.getByText(/Nice/u).closest("li");
    expect(bubble).not.toBeNull();

    rerender(list(asked, "Nice to meet"));
    expect(screen.getByText(/Nice to meet/u).closest("li")).toBe(bubble);

    // The whole reply lands under its own id: still the same element.
    rerender(list([...asked, REPLY], null));
    expect(screen.getByText(/Nice to meet you/u).closest("li")).toBe(bubble);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  test("the learner's line keeps its element when its id arrives", () => {
    const pending: Message = { id: "pending-1", role: "user", text: "Hi" };
    const { rerender } = render(list([OPENING, pending], ""));
    const bubble = screen.getByText("Hi").closest("li");

    rerender(list([OPENING, ANSWER], null));
    expect(screen.getByText("Hi").closest("li")).toBe(bubble);
  });

  test("says that the partner is getting ready before the first word", () => {
    render(list([], ""));
    expect(screen.getByText("Getting your partner ready…")).toBeInTheDocument();
  });

  test("hangs the length hint under the latest question only", () => {
    render(
      <MessageList
        messages={[OPENING, ANSWER, REPLY]}
        streaming={null}
        lengthHint="Try 2–3 sentences"
      />,
    );
    expect(screen.getAllByText("Ogmios: Try 2–3 sentences")).toHaveLength(1);
  });
});
