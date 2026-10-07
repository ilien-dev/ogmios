import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { i18n } from "@/lib/i18n/i18n";
import { useMockBackend } from "@/test/mockBackend";
import { Home } from "./Home";

describe("the conversation section", () => {
  useMockBackend();

  test("still opens on the start button, with its cards under it", async () => {
    render(<Home navigate={mock()} />);

    expect(
      await screen.findByRole("button", { name: "Start conversation" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /^2-minute drills/u }),
    ).toHaveTextContent("2 patterns due");
    expect(
      screen.getByRole("button", { name: /^Progress/u }),
    ).toHaveTextContent("4 days in a row · 2 rest days left this week");
  });

  test("the drills card opens the drills, without starting one", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Home navigate={navigate} />);

    await user.click(
      await screen.findByRole("button", { name: /^2-minute drills/u }),
    );
    expect(navigate).toHaveBeenCalledWith({
      name: "practice",
      patternId: null,
      format: null,
      autostart: false,
    });
  });

  test("the progress card opens the progress", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Home navigate={navigate} />);

    await user.click(await screen.findByRole("button", { name: /^Progress/u }));
    expect(navigate).toHaveBeenCalledWith({ name: "progress" });
  });

  test("what the cards say is not said again in a line under them", async () => {
    render(<Home navigate={mock()} />);

    await screen.findByRole("button", { name: "Start conversation" });
    expect(screen.getAllByText(/4 days in a row/u)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Practise" })).toBeNull();
  });

  test("the cards are in Spanish too", async () => {
    await i18n.changeLanguage("es");
    render(<Home navigate={mock()} />);

    expect(
      await screen.findByRole("button", { name: /^Ejercicios de 2 min/u }),
    ).toHaveTextContent("2 patrones pendientes");
    expect(
      screen.getByRole("button", { name: /^Progreso/u }),
    ).toBeInTheDocument();
  });
});
