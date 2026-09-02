// Exposed as the `@mosoo/runtime-catalog/icons` entry point. This module must
// stay free of imports from runtime-catalog.ts (and thus @mosoo/contracts /
// arktype): the web app renders RuntimeIcon on nearly every page, and any
// dependency added here lands on every page's critical download path.
import { GENERATED_RUNTIME_ICON_KEYS } from "./runtime-icon-keys.generated";

export function getRuntimeIconKey(runtimeId: string): string | null {
  return GENERATED_RUNTIME_ICON_KEYS[runtimeId] ?? null;
}
