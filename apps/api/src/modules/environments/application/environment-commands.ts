import type {
  CreateEnvironmentInput,
  EnvironmentDetail,
  EnvironmentSummary,
  SetAppDefaultEnvironmentInput,
  SetEnvironmentVariableValueInput,
  UpdateEnvironmentInput,
} from "@mosoo/contracts/environment";
import { environmentsTable, appsTable } from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, EnvironmentId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { currentTimestampMs } from "../../../time";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  ensureEnvironmentAccess,
  ensureEnvironmentEditor,
  getEnvironmentRecordRow,
} from "./environment-access.service";
import { buildStoredEnvVars, normalizeEnvironmentMetadata } from "./environment-config";
import {
  normalizeConfigForCreate,
  toConfig,
  toEnvironmentSummary,
} from "./environment-config-mapping";
import { resolveEnvironmentPackageArtifact } from "./environment-package-artifact.service";
import { getEnvironmentDetail } from "./environment-queries";
import type { EnvironmentMutableConfig } from "./environment-types";
import { createEnvironmentFromConfig, createRevision } from "./environment-write.service";

export async function createEnvironment(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: CreateEnvironmentInput,
): Promise<EnvironmentSummary> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const app = await ensureAppOwnership(bindings.DB, viewerId, input.appId);

  const metadata = normalizeEnvironmentMetadata(input);
  const environmentId = createPlatformId<EnvironmentId>();
  const normalized = normalizeConfigForCreate(input);
  const timestampMs = currentTimestampMs();
  const [envVars] = await Promise.all([
    buildStoredEnvVars(bindings, { envVars: input.envVars, environmentId }),
    resolveEnvironmentPackageArtifact(bindings, app.id, normalized.packages, {
      retryFailed: true,
    }),
  ]);
  const config: EnvironmentMutableConfig = {
    ...normalized,
    envVars,
  };
  await createEnvironmentFromConfig(bindings, {
    actorId: viewerId,
    config,
    description: metadata.description,
    environmentId,
    name: metadata.name,
    ownerId: viewerId,
    appId: app.id,
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
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const access = await ensureEnvironmentEditor(bindings.DB, viewerId, {
    environmentId: input.environmentId,
    appId: input.appId,
  });
  const beforeConfig = toConfig(access.row);
  const metadata = normalizeEnvironmentMetadata(input);
  const normalized = normalizeConfigForCreate(input);
  const timestampMs = currentTimestampMs();
  const [envVars] = await Promise.all([
    buildStoredEnvVars(bindings, {
      envVars: input.envVars,
      environmentId: access.row.id,
      previousEnvVars: beforeConfig.envVars,
    }),
    resolveEnvironmentPackageArtifact(bindings, access.row.appId, normalized.packages, {
      retryFailed: true,
    }),
  ]);
  const config: EnvironmentMutableConfig = {
    ...normalized,
    envVars,
  };
  const revisionId = await createRevision(bindings, {
    actorId: viewerId,
    config,
    environmentId: access.row.id,
    appId: access.row.appId,
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
    appId: access.row.appId,
  });
}

export async function setEnvironmentVariableValue(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: SetEnvironmentVariableValueInput,
): Promise<EnvironmentDetail> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const access = await ensureEnvironmentEditor(bindings.DB, viewerId, {
    environmentId: input.environmentId,
    appId: input.appId,
  });
  const beforeConfig = toConfig(access.row);
  const key = input.key.trim();
  const value = input.value;

  if (!/^[A-Z_][A-Z0-9_]*$/u.test(key)) {
    throw new Error(`Environment variable ${key} must use shell-style uppercase naming.`);
  }

  if (!value) {
    throw new Error("Environment variable value is required.");
  }

  if (!beforeConfig.envVars.some((envVar) => envVar.key === key)) {
    throw new Error(`Environment variable ${key} is not configured on this Environment.`);
  }

  const timestampMs = currentTimestampMs();
  const envVars = await buildStoredEnvVars(bindings, {
    envVars: beforeConfig.envVars.map((envVar) => ({
      key: envVar.key,
      value: envVar.key === key ? value : null,
    })),
    environmentId: access.row.id,
    previousEnvVars: beforeConfig.envVars,
  });
  const revisionId = await createRevision(bindings, {
    actorId: viewerId,
    config: {
      ...beforeConfig,
      envVars,
    },
    environmentId: access.row.id,
    appId: access.row.appId,
    timestampMs,
  });

  await getAppDatabase(bindings.DB)
    .update(environmentsTable)
    .set({
      currentRevisionId: revisionId,
      updatedAt: timestampMs,
    })
    .where(eq(environmentsTable.id, access.row.id))
    .run();

  return getEnvironmentDetail(bindings, viewer, {
    environmentId: access.row.id,
    appId: access.row.appId,
  });
}

export async function setAppDefaultEnvironment(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: SetAppDefaultEnvironmentInput,
): Promise<EnvironmentSummary> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureAppOwnership(bindings.DB, viewerId, input.appId);

  const access = await ensureEnvironmentAccess(bindings.DB, viewerId, {
    environmentId: input.environmentId,
    appId: input.appId,
  });

  if (access.row.appId !== input.appId) {
    throw forbiddenError("Environment belongs to another App.");
  }

  await getAppDatabase(bindings.DB)
    .update(appsTable)
    .set({
      defaultEnvironmentId: access.row.id,
      updatedAt: currentTimestampMs(),
    })
    .where(eq(appsTable.id, input.appId))
    .run();

  const row = await getEnvironmentRecordRow(bindings.DB, access.row.id);

  if (!row) {
    throw new Error("Environment not found.");
  }

  return toEnvironmentSummary(row);
}
