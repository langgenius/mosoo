import type { SandboxId, SandboxSessionId } from "@mosoo/id";

import {
  withDisposedRpcResource,
  withDisposedRpcResult,
} from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { withRuntimeProvisionTimeout } from "../runtime-provision-timeout";
import { getRuntimeSubjectKeepAliveHandle } from "../runtime-subject-lifecycle/runtime-subject-platform";

function isMissingSandboxSession(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "SessionNotFoundError" ||
      error.message.includes("SessionNotFoundError") ||
      (error.message.includes("Session '") && error.message.includes("' not found")))
  );
}

export async function deleteActiveSandboxConversationSession(
  bindings: ApiBindings,
  input: {
    readonly sandboxSessionId: SandboxSessionId;
    readonly sandboxId: SandboxId;
    readonly sandboxIncarnation: number;
  },
): Promise<void> {
  try {
    await withDisposedRpcResource(
      await getRuntimeSubjectKeepAliveHandle(bindings, input.sandboxId, input.sandboxIncarnation),
      async (sandbox) => {
        const deleted = await withDisposedRpcResult(
          withRuntimeProvisionTimeout(
            sandbox.deleteSession(input.sandboxSessionId),
            `Sandbox session deletion for ${input.sandboxSessionId}`,
          ),
          (deletedSession) => ({ success: deletedSession.success }),
        );

        if (!deleted.success) {
          throw new Error(`Sandbox session ${input.sandboxSessionId} could not be deleted.`);
        }
      },
    );
  } catch (error) {
    if (!isMissingSandboxSession(error)) {
      throw error;
    }
  }
}
