import type {
  AddSessionResourceInput,
  AddSessionResourceResult,
  SessionResource,
} from "@mosoo/contracts/session";
import { parsePlatformId } from "@mosoo/id";
import type { ProjectId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { fileStore } from "../../files/application/file-store";
import { ensureProjectSessionParticipantAccess } from "../domain/session-access.policy";
import type { SessionActionAuthorization } from "../domain/session-access.policy";
import { ensureSessionResourceCapability } from "./session-resource-capability.service";

export async function addSessionResource(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: AddSessionResourceInput,
  options: { authorization?: SessionActionAuthorization } = {},
): Promise<AddSessionResourceResult> {
  const sessionId = parsePlatformId<SessionId>(input.sessionId, "session id");
  const projectId = parsePlatformId<ProjectId>(input.projectId, "project id");
  await ensureSessionResourceCapability({
    action: "add_session_resource",
    ...(options.authorization ? { authorization: options.authorization } : {}),
    database: bindings.DB,
    projectId,
    sessionId,
    viewer,
  });

  return fileStore.createSessionResourceUpload(bindings, viewer, { ...input, sessionId });
}

export async function listSessionResources(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    projectId: ProjectId;
    sessionId: SessionId;
  },
): Promise<SessionResource[]> {
  await ensureProjectSessionParticipantAccess(database, viewer.id, input);
  return fileStore.listSessionResources(database, input.sessionId);
}
