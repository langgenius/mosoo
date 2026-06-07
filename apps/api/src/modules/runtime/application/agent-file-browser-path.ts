import { normalizeSandboxFileBrowserPath } from "agent-driver/paths";
import type { SandboxFileBrowserPathPurpose } from "agent-driver/paths";

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
