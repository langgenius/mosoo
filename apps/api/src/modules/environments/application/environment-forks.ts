import type {
  CreateEnvironmentForkInput,
  DeleteEnvironmentInput,
  EnvironmentSummary,
} from "@mosoo/contracts/environment";
import {
  agentsTable,
  environmentRevisionsTable,
  environmentsTable,
  resourceAclTable,
} from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, EnvironmentId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import {
  appendAuditEvent,
  resolveViewerAuditActor,
} from "../../audit/application/audit-query.service";
import { AUDIT_ACTION, AUDIT_RESOURCE } from "../../audit/domain/audit-vocabulary";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  ensureEnvironmentAccess,
  ensureEnvironmentEditor,
  getEnvironmentRecordRow,
} from "./environment-access.service";
import { toConfig, toEnvironmentSummary } from "./environment-config-mapping";
import {
  allocateCopyName,
  allocateCopyNamesByOwner,
  cloneConfigWithNewSecrets,
  collectCascadeForkUsers,
  createEnvironmentFromConfig,
} from "./environment-write.service";
export async function createEnvironmentFork(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateEnvironmentForkInput,
): Promise<EnvironmentSummary> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const access = await ensureEnvironmentAccess(bindings.DB, viewerId, input.environmentId);
  const environmentId = createPlatformId<EnvironmentId>();
  const config = await cloneConfigWithNewSecrets(bindings, {
    config: toConfig(access.row),
    environmentId,
  });
  const timestampMs = currentTimestampMs();
  const forkName = await allocateCopyName(
    bindings.DB,
    access.row.organizationId,
    viewerId,
    access.row.name,
  );
  const forkId = await createEnvironmentFromConfig(bindings, {
    actorId: viewerId,
    config,
    description: access.row.description,
    environmentId,
    forkedFromEnvironmentId: access.row.id,
    forkedFromEnvironmentName: access.row.name,
    forkedFromOwnerName: access.row.ownerName ?? "Organization",
    name: forkName,
    organizationId: access.row.organizationId,
    ownerId: viewerId,
    timestampMs,
  });

  await appendAuditEvent(bindings.DB, {
    action: AUDIT_ACTION.environmentFork,
    ...resolveViewerAuditActor(viewer),
    metadata: { sourceEnvironmentId: access.row.id },
    organizationId: access.row.organizationId,
    outcome: "success",
    resourceDisplay: forkName,
    resourceId: forkId,
    resourceType: AUDIT_RESOURCE.environment,
  });

  const fork = await getEnvironmentRecordRow(bindings.DB, forkId);

  if (!fork) {
    throw new Error("Environment fork could not be loaded.");
  }

  return toEnvironmentSummary(fork, viewerId, false);
}

export async function deleteEnvironment(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: DeleteEnvironmentInput,
): Promise<void> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const access = await ensureEnvironmentEditor(bindings.DB, viewerId, input.environmentId);

  if (access.row.ownerId === null) {
    throw forbiddenError("Built-in environments cannot be deleted.");
  }

  if (access.row.defaultEnvironmentId === access.row.id) {
    throw new Error("This environment is the organization default.");
  }

  const ownerId = access.row.ownerId;

  if (!ownerId) {
    throw forbiddenError("Built-in environments cannot be deleted.");
  }

  const ownerAgent =
    (await getAppDatabase(bindings.DB)
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(and(eq(agentsTable.environmentId, access.row.id), eq(agentsTable.ownerId, ownerId)))
      .limit(1)
      .get()) ?? null;

  if (ownerAgent) {
    throw new Error("This environment is still used by one or more of the owner's agents.");
  }

  const targetUserIds = await collectCascadeForkUsers(bindings.DB, access.row);
  const sourceConfig = toConfig(access.row);
  const ownerAtTimeId = access.row.ownerId ?? "organization";
  const timestampMs = currentTimestampMs();
  const forkNamesByTargetUserId = await allocateCopyNamesByOwner(
    bindings.DB,
    access.row.organizationId,
    targetUserIds,
    access.row.name,
  );

  for (const targetUserId of targetUserIds) {
    const forkEnvironmentId = createPlatformId<EnvironmentId>();
    const config = await cloneConfigWithNewSecrets(bindings, {
      config: sourceConfig,
      environmentId: forkEnvironmentId,
    });
    const forkName = forkNamesByTargetUserId.get(targetUserId) ?? `${access.row.name} copy`;
    const forkId = await createEnvironmentFromConfig(bindings, {
      actorId: viewerId,
      config,
      description: `Forked from ${access.row.ownerName ?? "a member"}'s deleted Environment.`,
      environmentId: forkEnvironmentId,
      forkedFromEnvironmentId: access.row.id,
      forkedFromEnvironmentName: access.row.name,
      forkedFromOwnerName: access.row.ownerName ?? "Organization",
      name: forkName,
      organizationId: access.row.organizationId,
      ownerId: targetUserId,
      timestampMs,
    });

    await getAppDatabase(bindings.DB)
      .update(agentsTable)
      .set({
        environmentId: forkId,
        updatedAt: timestampMs,
      })
      .where(
        and(
          eq(agentsTable.environmentId, access.row.id),
          eq(agentsTable.ownerId, targetUserId),
          eq(agentsTable.organizationId, access.row.organizationId),
        ),
      )
      .run();

    await appendAuditEvent(bindings.DB, {
      action: AUDIT_ACTION.environmentFork,
      ...resolveViewerAuditActor(viewer),
      metadata: {
        cascade: "true",
        sourceEnvironmentId: access.row.id,
        targetUserId,
      },
      organizationId: access.row.organizationId,
      outcome: "success",
      resourceDisplay: forkName,
      resourceId: forkId,
      resourceType: AUDIT_RESOURCE.environment,
    });
  }

  await getAppDatabase(bindings.DB)
    .delete(resourceAclTable)
    .where(
      and(
        eq(resourceAclTable.resourceType, "environment"),
        eq(resourceAclTable.resourceId, access.row.id),
      ),
    )
    .run();
  await getAppDatabase(bindings.DB)
    .delete(environmentRevisionsTable)
    .where(eq(environmentRevisionsTable.environmentId, access.row.id))
    .run();
  await getAppDatabase(bindings.DB)
    .delete(environmentsTable)
    .where(eq(environmentsTable.id, access.row.id))
    .run();

  await appendAuditEvent(bindings.DB, {
    action: AUDIT_ACTION.environmentDelete,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      owner_at_time_id: ownerAtTimeId,
      ...(access.row.ownerId !== viewerId ? { override: "organization_admin" } : {}),
    },
    organizationId: access.row.organizationId,
    outcome: "success",
    resourceDisplay: access.row.name,
    resourceId: access.row.id,
    resourceType: AUDIT_RESOURCE.environment,
  });
}
