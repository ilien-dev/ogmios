import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { i18n } from "@/lib/i18n/i18n";
import { useMockBackend } from "@/test/mockBackend";
import { Practice } from "./Practice";

describe("the drills", () => {
  useMockBackend();

  test("go by a name of their own, and lead back to conversation", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(
      <Practice
        patternId={null}
        format={null}
        autostart={false}
        navigate={navigate}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "2-minute drills" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Conversation" }));
    expect(navigate).toHaveBeenCalledWith({ name: "home" });
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
    expect(
      screen.getByRole("button", { name: "Conversación" }),
    ).toBeInTheDocument();
  });
});
