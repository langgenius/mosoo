import type { RemoveSessionResourceInput } from "@mosoo/contracts/session";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { deleteSessionResource } from "../../files/application/session-resource-file.service";
import type { SessionActionAuthorization } from "../domain/session-access.policy";
import { ensureSessionResourceCapability } from "./session-resource-capability.service";
import { publishSessionResourceDelete } from "./session-resource-events.service";

export async function removeSessionResource(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: RemoveSessionResourceInput,
  options: { authorization?: SessionActionAuthorization } = {},
): Promise<void> {
  await ensureSessionResourceCapability({
    action: "remove_session_resource",
    ...(options.authorization ? { authorization: options.authorization } : {}),
    database: bindings.DB,
    appId: input.appId,
    sessionId: input.sessionId,
    viewer,
  });

  const resource = await deleteSessionResource(bindings, viewer, input);

  await publishSessionResourceDelete({
    bindings,
    resourceId: resource.id,
    sessionId: input.sessionId,
  });
}
