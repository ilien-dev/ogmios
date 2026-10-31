import { describe, expect, mock, test } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { i18n } from "@/lib/i18n/i18n";
import { useMockBackend } from "@/test/mockBackend";
import type { Route } from "./routes";
import type { Entry } from "./TopNav";
import { entryOf, TopNav } from "./TopNav";

const ROUTES: Array<[Route, Entry | "settings"]> = [
  [{ name: "home" }, "conversation"],
  [{ name: "setup", preset: null }, "conversation"],
  [
    { name: "report", sessionId: "s", report: null, origin: "session" },
    "conversation",
  ],
  [
    { name: "practice", patternId: null, format: null, autostart: false },
    "drills",
  ],
  [{ name: "progress" }, "progress"],
  [
    { name: "report", sessionId: "s", report: null, origin: "progress" },
    "progress",
  ],
  [{ name: "books", bookId: null }, "books"],
  [{ name: "books", bookId: "b", chapterId: "c" }, "books"],
  [{ name: "recall" }, "recall"],
  [{ name: "structures" }, "structures"],
  [{ name: "listening" }, "listening"],
  [{ name: "settings" }, "settings"],
];

function names(nav: HTMLElement): string[] {
  return within(nav)
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent);
}

describe("TopNav", () => {
  useMockBackend();

  test.each(ROUTES)("the screen %j belongs to %s", (route, entry) => {
    expect(entryOf(route)).toBe(entry);
  });

  test("the top row holds the two groups and the settings", async () => {
    await i18n.changeLanguage("en");
    render(<TopNav route={{ name: "home" }} navigate={mock()} counts={{}} />);

    expect(names(screen.getByRole("navigation", { name: "Sections" }))).toEqual(
      ["Speak", "Read"],
    );
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();
  });

  test("the second row shows the group of the screen, each with what it is for", async () => {
    await i18n.changeLanguage("en");
    render(<TopNav route={{ name: "recall" }} navigate={mock()} counts={{}} />);

    const read = screen.getByRole("navigation", { name: "Read" });
    expect(
      within(read)
        .getAllByRole("button")
        .map((button) => button.firstChild?.textContent),
    ).toEqual(["Books", "Daily review", "Structures", "Listening"]);
    expect(
      within(read).getByText("Learned words come back over the days"),
    ).toBeVisible();
    expect(
      within(read).getByRole("button", { name: /Daily review/ }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Read" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("the settings belong to no group, so no second row shows", () => {
    render(
      <TopNav route={{ name: "settings" }} navigate={mock()} counts={{}} />,
    );

    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("what is due shows on its entry and, summed, on its group", async () => {
    await i18n.changeLanguage("en");
    render(
      <TopNav
        route={{ name: "home" }}
        navigate={mock()}
        counts={{ drills: 3, recall: 12, structures: 0 }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Read, 12 due today" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Speak, 3 due today" }),
    ).toBeVisible();
    const speak = screen.getByRole("navigation", { name: "Speak" });
    expect(within(speak).getByText("3")).toBeVisible();
  });

  test.each([
    ["en", "Read"],
    ["es", "Leer"],
  ])("a group opens on its first entry (%s)", async (language, label) => {
    const user = userEvent.setup();
    const navigate = mock();
    await i18n.changeLanguage(language);
    render(<TopNav route={{ name: "home" }} navigate={navigate} counts={{}} />);

    await user.click(screen.getByRole("button", { name: label }));
    expect(navigate).toHaveBeenCalledWith({ name: "books", bookId: null });
  });

  test("an entry opens its own screen", async () => {
    const user = userEvent.setup();
    const navigate = mock();
    await i18n.changeLanguage("en");
    render(<TopNav route={{ name: "home" }} navigate={navigate} counts={{}} />);

    await user.click(screen.getByRole("button", { name: /^Drills/ }));
    expect(navigate).toHaveBeenCalledWith({
      name: "practice",
      patternId: null,
      format: null,
      autostart: false,
    });
  });
});
