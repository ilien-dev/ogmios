import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setMockUpdate } from "@/lib/ipcMockUpdate";
import { useMockBackend } from "@/test/mockBackend";
import { version } from "../../../package.json";
import { AppUpdate } from "./AppUpdate";
import { UpdateHint } from "./UpdateHint";

describe("AppUpdate", () => {
  useMockBackend();

  test("shows the running version and says when it is the latest", async () => {
    render(<AppUpdate />);

    expect(await screen.findByText(`Version ${version}`)).toBeInTheDocument();
    expect(
      await screen.findByText("You have the latest version."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeInTheDocument();
  });

  test("offers a newer release and installs it", async () => {
    const user = userEvent.setup();
    setMockUpdate({ version: "9.0.0", notes: null });
    render(<AppUpdate />);

    expect(
      await screen.findByText("Version 9.0.0 is available."),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Update and restart" }),
    );
    expect(
      await screen.findByText("You have the latest version."),
    ).toBeInTheDocument();
  });

  test("a later check finds a release published since", async () => {
    const user = userEvent.setup();
    render(<AppUpdate />);
    await screen.findByText("You have the latest version.");

    setMockUpdate({ version: "9.0.0", notes: null });
    await user.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(
      await screen.findByText("Version 9.0.0 is available."),
    ).toBeInTheDocument();
  });
});

describe("UpdateHint", () => {
  useMockBackend();

  test("stays quiet on the latest version", async () => {
    render(<UpdateHint onOpen={mock()} />);

    expect(await screen.findByText(`v${version}`)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("points to a newer release on its own", async () => {
    const user = userEvent.setup();
    const onOpen = mock();
    setMockUpdate({ version: "9.0.0", notes: null });
    render(<UpdateHint onOpen={onOpen} />);

    await user.click(
      await screen.findByRole("button", { name: "Update to 9.0.0" }),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
