/** The mock's app version and the newer release it offers, if any. */
import type { UpdateDownload, UpdateInfo } from "@shared/domain";
import { version } from "../../package.json";

const BYTES = 78_000_000;

let pending: UpdateInfo | null = null;
let downloaded = false;

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
  downloaded = false;
}

type After = <T>(ms: number, value: () => T) => Promise<T>;
type Emit = (event: string, payload: unknown) => void;

export function updateCommands(
  after: After,
  emit: Emit,
): Record<string, (args: unknown) => Promise<unknown>> {
  const download = async (): Promise<void> => {
    if (pending === null) {
      throw new Error("no newer version");
    }
    const steps = 20;
    for (let step = 1; step <= steps; step += 1) {
      await after(150, () => null);
      emit("update-download", {
        received: Math.round((BYTES * step) / steps),
        total: BYTES,
      } satisfies UpdateDownload);
    }
    downloaded = true;
  };

  return {
    app_version: () => after(20, () => version),
    check_update: () => after(600, () => pending),
    download_update: download,
    // Installing restarts into the new version, which is then the latest.
    install_update: () =>
      after(1200, () => {
        if (!downloaded) {
          throw new Error("no downloaded update");
        }
        pending = null;
        downloaded = false;
      }),
  };
}
