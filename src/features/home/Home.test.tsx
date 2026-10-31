import { describe, expect, mock, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { i18n } from "@/lib/i18n/i18n";
import { useMockBackend } from "@/test/mockBackend";
import { Home } from "./Home";

describe("the conversation section", () => {
  useMockBackend();

  test("opens on the start button, with today's numbers beside it", async () => {
    render(<Home navigate={mock()} />);

    expect(
      await screen.findByRole("button", { name: "Start conversation" }),
    ).toBeEnabled();
    expect(screen.getByText("Days in a row").parentElement).toHaveTextContent(
      "4",
    );
    expect(screen.getByText("2 rest days left this week")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Patterns to practise/u }),
    ).toHaveTextContent("2");
  });

  test("the patterns open the drills, without starting one", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    render(<Home navigate={navigate} />);

    await user.click(
      await screen.findByRole("button", { name: /Patterns to practise/u }),
    );
    expect(navigate).toHaveBeenCalledWith({
      name: "practice",
      patternId: null,
      format: null,
      autostart: false,
    });
  });

  test("says what the partner will steer towards, once", async () => {
    render(<Home navigate={mock()} />);

    await screen.findByRole("button", { name: "Start conversation" });
    expect(screen.getAllByText(/what you're working on/u)).toHaveLength(1);
  });

  test("is in Spanish too", async () => {
    await i18n.changeLanguage("es");
    render(<Home navigate={mock()} />);

    expect(
      await screen.findByRole("button", { name: "Empezar charla" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /Patrones por practicar/u }),
    ).toBeInTheDocument();
    expect(screen.getByText("Días seguidos")).toBeInTheDocument();
  });
});
