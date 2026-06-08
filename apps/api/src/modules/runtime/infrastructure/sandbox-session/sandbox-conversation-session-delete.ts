import type { SandboxId, SandboxSessionId } from "@mosoo/id";

import {
  withDisposedRpcResource,
  withDisposedRpcResult,
} from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getRuntimeSubjectKeepAliveHandle } from "../runtime-subject-lifecycle/runtime-subject-platform";

export async function deleteActiveSandboxConversationSession(
  bindings: ApiBindings,
  input: {
    readonly sandboxSessionId: SandboxSessionId;
    readonly sandboxId: SandboxId;
  },
): Promise<void> {
  await withDisposedRpcResource(
    await getRuntimeSubjectKeepAliveHandle(bindings, input.sandboxId),
    async (sandbox) => {
      const deleted = await withDisposedRpcResult(
        sandbox.deleteSession(input.sandboxSessionId),
        (deletedSession) => ({
          success: deletedSession.success,
        }),
      );

      if (!deleted.success) {
        throw new Error(`Sandbox session ${input.sandboxSessionId} could not be deleted.`);
      }
    },
  );
}
