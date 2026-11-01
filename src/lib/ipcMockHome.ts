import type { HomeState } from "@shared/domain";
import { pick } from "./ipcMockData";

let patch: Partial<HomeState> = {};

/** What `home_state` answers differently, for a test of a rare state. */
export function setMockHome(next: Partial<HomeState>): void {
  patch = next;
}

export function mockHomePatch(): Partial<HomeState> {
  return patch;
}

export function resetMockHome(): void {
  patch = {};
}

export function mockChallenge(lang: Parameters<typeof pick>[0]): string {
  return pick(
    lang,
    "Usa dos veces el present perfect para hablar de experiencias.",
    "Use the present perfect twice to talk about experiences.",
  );
}
