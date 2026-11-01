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

    const home = await screen.findByRole("heading", {
      name: /Good to see you/u,
    });
    const loading = screen.getByText("Opening Ogmios…");
    expect(loading.closest("[inert]")).not.toBeNull();
    await waitForElementToBeRemoved(loading);
    expect(home.closest("[inert]")).toBeNull();
  });
});
