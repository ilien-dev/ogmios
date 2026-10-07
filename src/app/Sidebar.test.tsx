import { describe, expect, mock, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { i18n } from "@/lib/i18n/i18n";
import { useMockBackend } from "@/test/mockBackend";
import type { Route } from "./routes";
import type { Section } from "./Sidebar";
import { sectionOf, Sidebar } from "./Sidebar";

const ROUTES: Array<[Route, Section]> = [
  [{ name: "home" }, "conversation"],
  [{ name: "setup", preset: null }, "conversation"],
  [
    { name: "practice", patternId: null, format: null, autostart: false },
    "conversation",
  ],
  [{ name: "progress" }, "conversation"],
  [
    { name: "report", sessionId: "s", report: null, origin: "progress" },
    "conversation",
  ],
  [{ name: "books", bookId: null }, "book"],
  [{ name: "recall" }, "book"],
  [{ name: "listening" }, "book"],
  [{ name: "structures" }, "structures"],
  [{ name: "settings" }, "settings"],
];

describe("Sidebar", () => {
  useMockBackend();

  test("has three sections and the settings, and nothing else", () => {
    render(<Sidebar route={{ name: "home" }} navigate={mock()} counts={{}} />);

    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Conversation", "Book", "Structures", "Settings"]);
  });

  test.each(ROUTES)("the screen %j belongs to %s", (route, section) => {
    expect(sectionOf(route)).toBe(section);
  });

  test("marks the section of a screen that is no longer in the menu", () => {
    render(
      <Sidebar route={{ name: "recall" }} navigate={mock()} counts={{}} />,
    );

    expect(screen.getByRole("button", { name: "Book" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByRole("button", { name: "Conversation" }),
    ).not.toHaveAttribute("aria-current");
  });

  test("a section says how much is due today, and nothing when nothing is", () => {
    render(
      <Sidebar
        route={{ name: "home" }}
        navigate={mock()}
        counts={{ book: 3, conversation: 0 }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Book 3 due today" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Conversation" }),
    ).toBeInTheDocument();
  });

  test.each([
    ["en", "Book"],
    ["es", "Libro"],
  ])(
    "the book section opens on its own screen (%s)",
    async (language, label) => {
      const user = userEvent.setup();
      const navigate = mock();
      await i18n.changeLanguage(language);
      render(
        <Sidebar route={{ name: "home" }} navigate={navigate} counts={{}} />,
      );

      await user.click(screen.getByRole("button", { name: label }));
      expect(navigate).toHaveBeenCalledWith({ name: "books", bookId: null });
    },
  );
});
