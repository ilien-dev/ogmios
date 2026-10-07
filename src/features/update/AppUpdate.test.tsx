import { describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setMockUpdate } from "@/lib/ipcMockUpdate";
import { useMockBackend } from "@/test/mockBackend";
import { version } from "../../../package.json";
import { AppUpdate } from "./AppUpdate";
import { UpdateCard } from "./UpdateCard";
import { UpdateHint } from "./UpdateHint";
import { UpdateContext, UpdateProvider } from "./update";
import type { UpdateState, Updates } from "./update";

const NEWER = { version: "9.0.0", notes: null };

/** What a screen under the provider sees, with one state held still. */
function held(state: UpdateState, over: Partial<Updates> = {}): Updates {
  return {
    version,
    state,
    folded: false,
    check: mock(),
    download: mock(),
    restart: mock(),
    later: mock(),
    unfold: mock(),
    ...over,
  };
}

function Held({
  value,
  children,
}: {
  value: Updates;
  children: ReactNode;
}): ReactNode {
  return (
    <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
  );
}

describe("AppUpdate", () => {
  useMockBackend();

  test("shows the running version and says when it is the latest", async () => {
    render(
      <UpdateProvider>
        <AppUpdate />
      </UpdateProvider>,
    );

    expect(await screen.findByText(`Version ${version}`)).toBeInTheDocument();
    expect(
      await screen.findByText("You have the latest version."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Check for updates" }),
    ).toBeInTheDocument();
  });

  test("downloads a newer release, then restarts into it", async () => {
    const user = userEvent.setup();
    setMockUpdate(NEWER);
    render(
      <UpdateProvider>
        <AppUpdate />
      </UpdateProvider>,
    );

    expect(
      await screen.findByText("Version 9.0.0 is available."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Update" }));
    await user.click(await screen.findByRole("button", { name: "Restart" }));
    expect(
      await screen.findByText("You have the latest version."),
    ).toBeInTheDocument();
  });

  test("a later check finds a release published since", async () => {
    const user = userEvent.setup();
    render(
      <UpdateProvider>
        <AppUpdate />
      </UpdateProvider>,
    );
    await screen.findByText("You have the latest version.");

    setMockUpdate(NEWER);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));

    expect(
      await screen.findByText("Version 9.0.0 is available."),
    ).toBeInTheDocument();
  });
});

describe("UpdateProvider", () => {
  useMockBackend();

  test("finds a release published while the app is open", async () => {
    render(
      <UpdateProvider every={20}>
        <UpdateCard />
      </UpdateProvider>,
    );
    setMockUpdate(NEWER);

    expect(
      await screen.findByText("Ogmios 9.0.0 is available"),
    ).toBeInTheDocument();
  });

  test("looks again when the window comes back", async () => {
    render(
      <UpdateProvider rest={0}>
        <AppUpdate />
      </UpdateProvider>,
    );
    await screen.findByText("You have the latest version.");

    setMockUpdate(NEWER);
    globalThis.dispatchEvent(new Event("focus"));

    expect(
      await screen.findByText("Version 9.0.0 is available."),
    ).toBeInTheDocument();
  });

  test("a window that just looked does not look again", async () => {
    render(
      <UpdateProvider>
        <AppUpdate />
      </UpdateProvider>,
    );
    await screen.findByText("You have the latest version.");

    setMockUpdate(NEWER);
    globalThis.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(screen.queryByText("Version 9.0.0 is available.")).toBeNull();
  });

  test("the card downloads on request and goes once restarted", async () => {
    const user = userEvent.setup();
    setMockUpdate(NEWER);
    render(
      <UpdateProvider>
        <UpdateCard />
      </UpdateProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "Update" }));
    expect(
      await screen.findByText("9.0.0 is ready to install"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() => {
      expect(screen.queryByRole("complementary")).toBeNull();
    });
  });

  test("Later folds the card until the hint opens it again", async () => {
    const user = userEvent.setup();
    setMockUpdate(NEWER);
    render(
      <UpdateProvider>
        <UpdateHint />
        <UpdateCard />
      </UpdateProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByText("Ogmios 9.0.0 is available")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Update to 9.0.0" }));
    expect(screen.getByText("Ogmios 9.0.0 is available")).toBeInTheDocument();
  });
});

describe("UpdateCard", () => {
  useMockBackend();

  test("shows nothing on the latest version", () => {
    const { container } = render(
      <Held value={held({ kind: "current" })}>
        <UpdateCard />
      </Held>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test("shows how far the download is", () => {
    render(
      <Held
        value={held({
          kind: "downloading",
          version: "9.0.0",
          progress: { received: 48_000_000, total: 78_000_000 },
        })}
      >
        <UpdateCard />
      </Held>,
    );

    expect(screen.getByText("Downloading 9.0.0")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "61",
    );
    expect(screen.getByText("61%")).toBeInTheDocument();
    expect(screen.getByText("48 MB of 78 MB")).toBeInTheDocument();
  });

  test("a download of unknown size shows a bar with no figure", () => {
    render(
      <Held
        value={held({
          kind: "downloading",
          version: "9.0.0",
          progress: { received: 48_000_000, total: null },
        })}
      >
        <UpdateCard />
      </Held>,
    );

    expect(screen.getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuenow",
    );
    expect(screen.getByText("48 MB")).toBeInTheDocument();
  });

  test("a failed download says why and offers another try", async () => {
    const user = userEvent.setup();
    const value = held({
      kind: "failed",
      version: "9.0.0",
      message: "No connection.",
    });
    render(
      <Held value={value}>
        <UpdateCard />
      </Held>,
    );

    expect(screen.getByText("No connection.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(value.download).toHaveBeenCalledTimes(1);
  });

  test("a failed check is not the card's to show", () => {
    const { container } = render(
      <Held
        value={held({ kind: "failed", version: null, message: "Offline." })}
      >
        <UpdateCard />
      </Held>,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("UpdateHint", () => {
  useMockBackend();

  test("checks when the version is pressed and says it is the latest", async () => {
    const user = userEvent.setup();
    render(
      <UpdateProvider>
        <UpdateHint />
      </UpdateProvider>,
    );

    await user.click(
      await screen.findByRole("button", { name: `v${version}` }),
    );
    expect(
      await screen.findByText(`v${version} · up to date`),
    ).toBeInTheDocument();
  });

  test("points to a newer release on its own", async () => {
    setMockUpdate(NEWER);
    render(
      <UpdateProvider>
        <UpdateHint />
      </UpdateProvider>,
    );

    expect(
      await screen.findByRole("button", { name: "Update to 9.0.0" }),
    ).toBeInTheDocument();
  });

  test("says when the check could not be made", async () => {
    const user = userEvent.setup();
    const value = held({ kind: "failed", version: null, message: "Offline." });
    render(
      <Held value={value}>
        <UpdateHint />
      </Held>,
    );

    await user.click(screen.getByRole("button", { name: `v${version}` }));
    expect(value.check).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Couldn't check")).toBeInTheDocument();
  });
});
