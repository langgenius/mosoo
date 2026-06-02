import { resolveViewerAuditActor } from "../../audit/application/audit-query.service";
import type { AuditActorInput } from "../../audit/application/audit-query.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import type { SessionActionAuthorization } from "../domain/session-access.policy";

export interface SessionMutationOptions {
  authorization?: SessionActionAuthorization | undefined;
  auditActor?: AuditActorInput | undefined;
}

export function resolveSessionMutationAuditActor(
  viewer: AuthenticatedViewer,
  auditActor?: AuditActorInput,
) {
  if (!auditActor) {
    return resolveViewerAuditActor(viewer);
  }

  return {
    actorDisplay: auditActor.display,
    actorId: auditActor.id,
    actorMetadata: auditActor.metadata ?? {},
    actorType: auditActor.type,
    ipAddress: auditActor.ipAddress ?? viewer.auditContext?.ipAddress ?? null,
    userAgent: auditActor.userAgent ?? viewer.auditContext?.userAgent ?? null,
  };
}
