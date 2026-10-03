/** The mock's app version and the newer release it offers, if any. */
import type { UpdateInfo } from "@shared/domain";
import { version } from "../../package.json";

let pending: UpdateInfo | null = null;

try {
  if (
    new URLSearchParams(globalThis.location.search).get("mock") === "update"
  ) {
    pending = { version: "9.9.9", notes: null };
  }
} catch {
  // No location outside a browser: nothing on offer.
}

/** The release `check_update` offers; null means this one is the latest. */
export function setMockUpdate(update: UpdateInfo | null): void {
  pending = update;
}

type After = <T>(ms: number, value: () => T) => Promise<T>;

export function updateCommands(
  after: After,
): Record<string, (args: unknown) => Promise<unknown>> {
  return {
    app_version: () => after(20, () => version),
    check_update: () => after(600, () => pending),
    // Installing restarts into the new version, which is then the latest.
    install_update: () =>
      after(1200, () => {
        pending = null;
      }),
  };
}
