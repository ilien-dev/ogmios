import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import {
  render,
  screen,
  waitForElementToBeRemoved,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MotionGlobalConfig } from "motion/react";
import { useMockBackend } from "@/test/mockBackend";
import { App } from "./App";

describe("App", () => {
  useMockBackend();

  const nativeAnimate = Element.prototype.animate;

  // As in `motion.test.tsx`: real exits, on motion's own frame loop.
  beforeEach(() => {
    MotionGlobalConfig.skipAnimations = false;
    Reflect.deleteProperty(Element.prototype, "animate");
    spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    MotionGlobalConfig.skipAnimations = true;
    Element.prototype.animate = nativeAnimate;
    mock.restore();
  });

  test("the app fades in over the loading screen, which leaves and cannot be used", async () => {
    render(<App />);
    expect(screen.getByText("Opening Ogmios…")).toBeInTheDocument();

    // Today opens first, with the rail and its four places beside it.
    const home = await screen.findByRole("navigation", { name: "Places" });
    const loading = screen.getByText("Opening Ogmios…");
    expect(loading.closest("[inert]")).not.toBeNull();
    await waitForElementToBeRemoved(loading);
    expect(home.closest("[inert]")).toBeNull();
  });

  test("Settings closes back to the place it was opened from", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Book" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await user.click(
      await screen.findByRole("button", { name: "Close settings" }),
    );
    expect(await screen.findByRole("button", { name: "Book" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByRole("button", { name: "Close settings" });
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("button", { name: "Book" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
