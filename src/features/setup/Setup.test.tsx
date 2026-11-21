import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readyProfile } from "@/lib/ipcMock";
import { useMockBackend } from "@/test/mockBackend";
import { Setup } from "./Setup";

describe("Setup", () => {
  useMockBackend();

  test("has a way back to Chat, where it was opened from", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(
      <Setup profile={readyProfile()} preset={null} navigate={navigate} />,
    );

    await user.click(screen.getByRole("button", { name: "Back to Chat" }));
    expect(navigate).toHaveBeenCalledWith({ name: "home" });
  });
});
