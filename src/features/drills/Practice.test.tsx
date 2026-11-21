import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { i18n } from "@/lib/i18n/i18n";
import * as ipc from "@/lib/ipc";
import { useMockBackend } from "@/test/mockBackend";
import { Practice } from "./Practice";

describe("the drills", () => {
  useMockBackend();

  afterEach(() => {
    mock.restore();
  });

  test("a round starts at once, with no screen of its own before it", async () => {
    render(
      <Practice
        patternId={null}
        format={null}
        navigate={mock()}
        onLeave={mock()}
      />,
    );

    expect(screen.getByText("Preparing your round…")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "End practice" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "2-minute drills" }),
    ).toBeNull();
  });

  test("leaving a round goes back to wherever it was started", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    const onLeave = mock();
    render(
      <Practice
        patternId="p"
        format={null}
        navigate={navigate}
        onLeave={onLeave}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "End practice" }),
    );
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  test("a round that cannot start says why and still has a way out", async () => {
    const user = userEvent.setup();
    const onLeave = mock();
    spyOn(ipc, "startDrill").mockRejectedValue(new Error("No drill."));
    render(
      <Practice
        patternId={null}
        format={null}
        navigate={mock()}
        onLeave={onLeave}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("No drill.");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  test("the way out is named in Spanish too", async () => {
    await i18n.changeLanguage("es");
    spyOn(ipc, "startDrill").mockRejectedValue(new Error("No drill."));
    render(
      <Practice
        patternId={null}
        format={null}
        navigate={mock()}
        onLeave={mock()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Volver" }),
    ).toBeInTheDocument();
  });
});
