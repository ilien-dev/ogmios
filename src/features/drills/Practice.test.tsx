import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { i18n } from "@/lib/i18n/i18n";
import { useMockBackend } from "@/test/mockBackend";
import { Practice } from "./Practice";

describe("the drills", () => {
  useMockBackend();

  test("go by a name of their own, and leave the way out to the menu", () => {
    render(
      <Practice
        patternId={null}
        format={null}
        autostart={false}
        navigate={mock()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "2-minute drills" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Conversation" })).toBeNull();
  });

  test("are named in Spanish too", async () => {
    await i18n.changeLanguage("es");
    render(
      <Practice
        patternId={null}
        format={null}
        autostart={false}
        navigate={mock()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Ejercicios de 2 min" }),
    ).toBeInTheDocument();
  });

  test("a drill ends back on the drills, wherever it was started", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(
      <Practice patternId="p" format={null} autostart navigate={navigate} />,
    );

    await user.click(
      await screen.findByRole("button", { name: "End practice" }),
    );
    expect(navigate).toHaveBeenCalledWith({
      name: "practice",
      patternId: null,
      format: null,
      autostart: false,
    });
  });
});
