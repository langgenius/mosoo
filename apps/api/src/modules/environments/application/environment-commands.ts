import type {
  CreateEnvironmentInput,
  DeleteEnvironmentInput,
  EnvironmentDetail,
  EnvironmentSummary,
  SetProjectDefaultEnvironmentInput,
  UpdateEnvironmentInput,
} from "@mosoo/contracts/environment";
import {
  agentsTable,
  environmentRevisionsTable,
  environmentsTable,
  projectsTable,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { EnvironmentId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureProjectOwnership } from "../../projects/application/project.service";
import {
  ensureEnvironmentAccess,
  ensureEnvironmentEditor,
  getEnvironmentRecordRow,
} from "./environment-access.service";
import {
  buildStoredEnvVars,
  normalizeEnvironmentConfigInput,
  normalizeEnvironmentMetadata,
} from "./environment-config";
import { toConfig, toEnvironmentSummary } from "./environment-config-mapping";
import { resolveEnvironmentPackageArtifact } from "./environment-package-artifact.service";
import { getEnvironmentDetail } from "./environment-queries";
import { createEnvironmentFromConfig, createRevision } from "./environment-write.service";

export async function createEnvironment(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateEnvironmentInput,
): Promise<EnvironmentSummary> {
  const project = await ensureProjectOwnership(bindings.DB, viewer.id, input.projectId);

  const metadata = normalizeEnvironmentMetadata(input);
  const environmentId = createPlatformId<EnvironmentId>();
  const normalized = normalizeEnvironmentConfigInput(input);
  const timestampMs = currentTimestampMs();
  const [envVars] = await Promise.all([
    buildStoredEnvVars(bindings, { envVars: input.envVars }),
    resolveEnvironmentPackageArtifact(bindings, project.id, normalized.packages, {
      retryFailed: true,
    }),
  ]);
  await createEnvironmentFromConfig(bindings, {
    actorId: viewer.id,
    config: { ...normalized, envVars },
    description: metadata.description,
    environmentId,
    name: metadata.name,
    ownerId: viewer.id,
    projectId: project.id,
    timestampMs,
  });

  const created = await getEnvironmentRecordRow(bindings.DB, environmentId);

  if (!created) {
    throw new Error("Environment could not be loaded after creation.");
  }

  return toEnvironmentSummary(created);
}

export async function updateEnvironment(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: UpdateEnvironmentInput,
): Promise<EnvironmentDetail> {
  const access = await ensureEnvironmentEditor(bindings.DB, viewer.id, {
    environmentId: input.environmentId,
    projectId: input.projectId,
  });
  const metadata = normalizeEnvironmentMetadata(input);
  const normalized = normalizeEnvironmentConfigInput(input);
  const timestampMs = currentTimestampMs();
  const [envVars] = await Promise.all([
    buildStoredEnvVars(bindings, {
      envVars: input.envVars,
      previousEnvVars: toConfig(access.row).envVars,
    }),
    resolveEnvironmentPackageArtifact(bindings, access.row.projectId, normalized.packages, {
      retryFailed: true,
    }),
  ]);
  const revisionId = await createRevision(bindings, {
    actorId: viewer.id,
    config: { ...normalized, envVars },
    environmentId: access.row.id,
    projectId: access.row.projectId,
    timestampMs,
  });

  await getAppDatabase(bindings.DB)
    .update(environmentsTable)
    .set({
      currentRevisionId: revisionId,
      description: metadata.description,
      name: metadata.name,
      updatedAt: timestampMs,
    })
    .where(eq(environmentsTable.id, access.row.id))
    .run();

  return getEnvironmentDetail(bindings, viewer, {
    environmentId: access.row.id,
    projectId: access.row.projectId,
  });
}

export async function setProjectDefaultEnvironment(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: SetProjectDefaultEnvironmentInput,
): Promise<EnvironmentSummary> {
  const access = await ensureEnvironmentAccess(bindings.DB, viewer.id, {
    environmentId: input.environmentId,
    projectId: input.projectId,
  });

  await getAppDatabase(bindings.DB)
    .update(projectsTable)
    .set({
      defaultEnvironmentId: access.row.id,
      updatedAt: currentTimestampMs(),
    })
    .where(eq(projectsTable.id, input.projectId))
    .run();

  return toEnvironmentSummary({ ...access.row, defaultEnvironmentId: access.row.id });
}

export async function deleteEnvironment(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: DeleteEnvironmentInput,
): Promise<void> {
  const access = await ensureEnvironmentEditor(bindings.DB, viewer.id, {
    environmentId: input.environmentId,
    projectId: input.projectId,
  });

  if (access.row.defaultEnvironmentId === access.row.id) {
    throw new Error("This environment is the Project default.");
  }

  const agent = await getAppDatabase(bindings.DB)
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(eq(agentsTable.environmentId, access.row.id))
    .limit(1)
    .get();

  if (agent) {
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
