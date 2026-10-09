// Exposed as the `@mosoo/runtime-catalog/icons` entry point. This module must
// stay free of runtime imports from @mosoo/contracts (arktype): the web app
// renders RuntimeIcon on nearly every page, and any dependency added here lands
// on every page's critical download path.
import { RUNTIMES } from "./catalog";

const RUNTIME_ICON_KEYS = new Map(
  RUNTIMES.map((runtime) => [runtime.runtimeId, runtime.display.iconKey]),
);

export function getRuntimeIconKey(runtimeId: string): string | null {
  return RUNTIME_ICON_KEYS.get(runtimeId) ?? null;
}
