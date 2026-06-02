import { VENDOR_OPENAI_COMPATIBLE } from "@mosoo/runtime-catalog";

import {
  appendAuditEvent,
  resolveViewerAuditActor,
} from "../../audit/application/audit-query.service";
import { AUDIT_RESOURCE, createAuditAction } from "../../audit/domain/audit-vocabulary";
import type { AuditAction } from "../../audit/domain/audit-vocabulary";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
function auditActionForCredential(
  _vendorId: string,
  verb: "create" | "delete" | "update",
): AuditAction {
  return createAuditAction(AUDIT_RESOURCE.credential, verb);
}

export async function appendCredentialAuditEvent(input: {
  database: D1Database;
  name: string;
  organizationId: string;
  resourceId: string;
  vendorId: string;
  verb: "create" | "delete" | "update";
  viewer: AuthenticatedViewer;
}): Promise<void> {
  await appendAuditEvent(input.database, {
    action: auditActionForCredential(input.vendorId, input.verb),
    ...resolveViewerAuditActor(input.viewer),
    metadata: {
      credentialKind:
        input.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId ? "custom_provider" : "provider",
      vendorId: input.vendorId,
    },
    organizationId: input.organizationId,
    outcome: "success",
    resourceDisplay: input.name,
    resourceId: input.resourceId,
    resourceType: AUDIT_RESOURCE.credential,
  });
}
