import { normalizeSandboxFileBrowserPath } from "@mosoo/driver-protocol";
import type { SandboxFileBrowserPathPurpose } from "@mosoo/driver-protocol";

import { validationError } from "../../../platform/errors";

export type AgentFileBrowserPathPurpose = SandboxFileBrowserPathPurpose;

export function normalizeAgentFileBrowserPath(
  rawPath: string,
  purpose: AgentFileBrowserPathPurpose,
): string {
  try {
    return normalizeSandboxFileBrowserPath(rawPath, purpose);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid agent file path.";
    throw validationError(message);
  }
}
