import type { SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { createSandboxExecutionPlaneAdapter } from "../../infrastructure/execution-plane/sandbox-execution-plane-adapter";

const executionPlane = createSandboxExecutionPlaneAdapter();

export async function ensureActiveSessionResourcesMaterialized(
  bindings: ApiBindings,
  sessionId: SessionId,
): Promise<void> {
  await executionPlane.materializeActiveSessionResources(bindings, { sessionId });
}
