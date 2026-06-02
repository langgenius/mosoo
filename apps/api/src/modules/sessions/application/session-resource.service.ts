import type {
  AddSessionResourceInput,
  AddSessionResourceResult,
  SessionResource,
} from "@mosoo/contracts/session";
import { parsePlatformId } from "@mosoo/id";
import type { SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  createSessionResourceUpload,
  listSessionResourcesForParticipant,
} from "../../files/application/session-resource-file.service";
import type { SessionActionAuthorization } from "../domain/session-access.policy";
import { ensureSessionResourceCapability } from "./session-resource-capability.service";

export async function addSessionResource(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: AddSessionResourceInput,
  options: { authorization?: SessionActionAuthorization } = {},
): Promise<AddSessionResourceResult> {
  const sessionId = parsePlatformId<SessionId>(input.sessionId, "session id");
  await ensureSessionResourceCapability({
    action: "add_session_resource",
    ...(options.authorization ? { authorization: options.authorization } : {}),
    database: bindings.DB,
    sessionId,
    viewer,
  });

  return createSessionResourceUpload(bindings, viewer, { ...input, sessionId });
}

export async function listSessionResources(
  database: D1Database,
  viewer: AuthenticatedViewer,
  sessionId: SessionId,
): Promise<SessionResource[]> {
  return listSessionResourcesForParticipant(database, viewer.id, sessionId);
}
