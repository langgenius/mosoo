import type {
  EnvironmentShareTarget,
  EnvironmentShareTargetId,
  EnvironmentShareTargetKind,
  ShareEnvironmentWithOrganizationInput,
  ShareEnvironmentWithUserInput,
  UnshareEnvironmentTargetInput,
} from "@mosoo/contracts/environment";
import { accountsTable, organizationMembersTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { and, eq, isNull, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../../time";
import {
  appendAuditEvent,
  resolveViewerAuditActor,
} from "../../audit/application/audit-query.service";
import { AUDIT_ACTION, AUDIT_RESOURCE } from "../../audit/domain/audit-vocabulary";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  deleteResourceAcl,
  insertResourceAclIfAbsent,
  toOrganizationAclTarget,
  toUserAclTarget,
} from "../../resource-access/application/resource-acl.service";
import type { ResourceAclTarget } from "../../resource-access/application/resource-acl.service";
import { ensureEnvironmentEditor } from "./environment-access.service";
import type { EnvironmentAccessResult } from "./environment-access.service";

function toEnvironmentAclTarget(
  targetKind: EnvironmentShareTargetKind,
  targetId: EnvironmentShareTargetId,
): ResourceAclTarget {
  if (targetKind === "organization") {
    return toOrganizationAclTarget(
      parsePlatformId<OrganizationId>(targetId, "environment share organization ID"),
    );
  }

  return toUserAclTarget(parsePlatformId<AccountId>(targetId, "environment share account ID"));
}

function environmentOwnerAuditMetadata(
  access: EnvironmentAccessResult,
  viewerId: AccountId,
): Record<string, string> {
  const ownerAtTimeId = access.row.ownerId ?? "organization";

  return {
    owner_at_time_id: ownerAtTimeId,
    ...(access.row.ownerId !== viewerId ? { override: "organization_admin" } : {}),
  };
}

export async function shareEnvironmentWithUser(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ShareEnvironmentWithUserInput,
): Promise<EnvironmentShareTarget> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const access = await ensureEnvironmentEditor(bindings.DB, viewerId, input.environmentId);
  const target =
    (await getAppDatabase(bindings.DB)
      .select({
        email: accountsTable.email,
        id: accountsTable.id,
        name: accountsTable.name,
      })
      .from(organizationMembersTable)
      .innerJoin(accountsTable, eq(accountsTable.id, organizationMembersTable.accountId))
      .where(
        and(
          eq(organizationMembersTable.organizationId, access.row.organizationId),
          sql`lower(${accountsTable.email}) = lower(${input.email.trim()})`,
          isNull(organizationMembersTable.disabledAt),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!target) {
    throw new Error("Organization member not found.");
  }

  if (target.id === access.row.ownerId) {
    throw new Error("Owner does not need an explicit share target.");
  }

  const timestampMs = currentTimestampMs();

  const aclAssignment = await insertResourceAclIfAbsent(bindings.DB, {
    assignedByAccountId: viewerId,
    createdAt: timestampMs,
    resourceId: access.row.id,
    resourceType: "environment",
    role: "user",
    target: toUserAclTarget(target.id),
  });

  await appendAuditEvent(bindings.DB, {
    action: AUDIT_ACTION.environmentShare,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      targetId: target.id,
      targetKind: "user",
      ...environmentOwnerAuditMetadata(access, viewerId),
    },
    organizationId: access.row.organizationId,
    outcome: "success",
    resourceDisplay: access.row.name,
    resourceId: access.row.id,
    resourceType: AUDIT_RESOURCE.environment,
  });

  return {
    createdAt: toIsoString(aclAssignment.createdAt),
    email: target.email,
    id: target.id,
    kind: "user",
    name: target.name,
  };
}

export async function shareEnvironmentWithOrganization(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: ShareEnvironmentWithOrganizationInput,
): Promise<EnvironmentShareTarget> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const access = await ensureEnvironmentEditor(bindings.DB, viewerId, input.environmentId);
  const timestampMs = currentTimestampMs();

  const aclAssignment = await insertResourceAclIfAbsent(bindings.DB, {
    assignedByAccountId: viewerId,
    createdAt: timestampMs,
    resourceId: access.row.id,
    resourceType: "environment",
    role: "user",
    target: toOrganizationAclTarget(access.row.organizationId),
  });

  await appendAuditEvent(bindings.DB, {
    action: AUDIT_ACTION.environmentShare,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      targetId: access.row.organizationId,
      targetKind: "organization",
      ...environmentOwnerAuditMetadata(access, viewerId),
    },
    organizationId: access.row.organizationId,
    outcome: "success",
    resourceDisplay: access.row.name,
    resourceId: access.row.id,
    resourceType: AUDIT_RESOURCE.environment,
  });

  return {
    createdAt: toIsoString(aclAssignment.createdAt),
    email: null,
    id: access.row.organizationId,
    kind: "organization",
    name: "Everyone in organization",
  };
}

export async function unshareEnvironmentTarget(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: UnshareEnvironmentTargetInput,
): Promise<void> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const access = await ensureEnvironmentEditor(bindings.DB, viewerId, input.environmentId);

  await deleteResourceAcl(bindings.DB, {
    resourceId: access.row.id,
    resourceType: "environment",
    target: toEnvironmentAclTarget(input.targetKind, input.targetId),
  });

  await appendAuditEvent(bindings.DB, {
    action: AUDIT_ACTION.environmentUnshare,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      targetId: input.targetId,
      targetKind: input.targetKind,
      ...environmentOwnerAuditMetadata(access, viewerId),
    },
    organizationId: access.row.organizationId,
    outcome: "success",
    resourceDisplay: access.row.name,
    resourceId: access.row.id,
    resourceType: AUDIT_RESOURCE.environment,
  });
}
