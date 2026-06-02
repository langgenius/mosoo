import { disposeRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { isRuntimeSandboxLocalBucketEnabled } from "../runtime-sandbox-bucket-mount";
import { getRuntimeSubjectKeepAliveHandle } from "../runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import { getRuntimeConversationSession } from "../runtime-subject-lifecycle/runtime-subject-store";
import { parseSandboxConversationSpaceAliases } from "../sandbox-session/sandbox-conversation-session-codec";
import { syncSandboxSpaceTreesToCanonical } from "../sandbox-space-file-sync.service";
import type { RuntimeSessionLink } from "./event-types";

export async function syncLocalSandboxSpaceFilesAfterTurn(
  bindings: ApiBindings,
  link: RuntimeSessionLink,
): Promise<void> {
  if (!isRuntimeSandboxLocalBucketEnabled(bindings) || !hasSpaceSyncLinkFields(link)) {
    return;
  }

  const sandboxSession = await getRuntimeConversationSession(bindings.DB, link.sessionId);

  if (sandboxSession?.status !== "active") {
    return;
  }

  const spaceAliases = parseSandboxConversationSpaceAliases(sandboxSession.spaceAliasesJson);

  if (spaceAliases.length === 0) {
    return;
  }

  const sandbox = await getRuntimeSubjectKeepAliveHandle(bindings, link.sandboxId);

  try {
    await syncSandboxSpaceTreesToCanonical({
      bindings,
      executionOwnerUserId: link.executionOwnerId,
      sandbox,
      spaceAliases,
    });
  } finally {
    disposeRpcResource(sandbox);
  }
}

function hasNonEmptyString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasSpaceSyncLinkFields(link: RuntimeSessionLink): link is RuntimeSessionLink & {
  executionOwnerId: string;
  sandboxId: string;
  sessionId: string;
} {
  return (
    hasNonEmptyString(link.executionOwnerId) &&
    hasNonEmptyString(link.sandboxId) &&
    hasNonEmptyString(link.sessionId)
  );
}
