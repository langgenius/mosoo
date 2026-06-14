import type {
  CreateEnvironmentForkInput,
  DeleteEnvironmentInput,
  EnvironmentSummary,
} from "@mosoo/contracts/environment";
import { agentsTable, environmentRevisionsTable, environmentsTable } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, EnvironmentId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  ensureEnvironmentAccess,
  ensureEnvironmentEditor,
  getEnvironmentRecordRow,
} from "./environment-access.service";
import { toConfig, toEnvironmentSummary } from "./environment-config-mapping";
import {
  allocateCopyName,
  cloneConfigWithNewSecrets,
  createEnvironmentFromConfig,
} from "./environment-write.service";
export async function createEnvironmentFork(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateEnvironmentForkInput,
): Promise<EnvironmentSummary> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const access = await ensureEnvironmentAccess(bindings.DB, viewerId, {
    environmentId: input.environmentId,
    appId: input.appId,
  });
  const environmentId = createPlatformId<EnvironmentId>();
  const config = await cloneConfigWithNewSecrets(bindings, {
    config: toConfig(access.row),
    environmentId,
  });
  const timestampMs = currentTimestampMs();
  const forkName = await allocateCopyName(bindings.DB, access.row.appId, viewerId, access.row.name);
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
    appId: access.row.appId,
    timestampMs,
  });

  const fork = await getEnvironmentRecordRow(bindings.DB, forkId);

  if (!fork) {
    throw new Error("Environment fork could not be loaded.");
  }

  return toEnvironmentSummary(fork);
}

export async function deleteEnvironment(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: DeleteEnvironmentInput,
): Promise<void> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const access = await ensureEnvironmentEditor(bindings.DB, viewerId, {
    environmentId: input.environmentId,
    appId: input.appId,
  });

  if (access.row.ownerId === null) {
    throw forbiddenError("Built-in environments cannot be deleted.");
  }

  if (access.row.defaultEnvironmentId === access.row.id) {
    throw new Error("This environment is the App default.");
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

  await getAppDatabase(bindings.DB)
    .delete(environmentRevisionsTable)
    .where(eq(environmentRevisionsTable.environmentId, access.row.id))
    .run();
  await getAppDatabase(bindings.DB)
    .delete(environmentsTable)
    .where(eq(environmentsTable.id, access.row.id))
    .run();
}
