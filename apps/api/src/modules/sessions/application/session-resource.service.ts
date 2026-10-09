import type { AddSessionResourceInput, AddSessionResourceResult } from "@mosoo/contracts/session";
import { getAvailableAgentSessionActionCapability } from "@mosoo/session-policy";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { fileStore } from "../../files/application/file-store";
import { requireProjectSession } from "../domain/session-access.policy";

export async function addSessionResource(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: AddSessionResourceInput,
): Promise<AddSessionResourceResult> {
  const session = await requireProjectSession(bindings.DB, viewer.id, {
    projectId: input.projectId,
    sessionId: input.sessionId,
  });
  getAvailableAgentSessionActionCapability({
    action: "add_session_resource",
    archivedAt: session.archived_at,
    runtimeId: session.runtime_id,
    status: session.status,
  });

  return fileStore.createSessionResourceUpload(bindings, viewer, input);
}
