import { environmentRevisionsTable, environmentsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, EnvironmentId, EnvironmentRevisionId, ProjectId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { serializeConfig } from "./environment-config";
import type { EnvironmentMutableConfig } from "./environment-types";

function toRevisionValues(input: {
  actorId: AccountId | null;
  config: EnvironmentMutableConfig;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  revisionId: EnvironmentRevisionId;
  timestampMs: number;
}) {
  return {
    ...serializeConfig(input.config),
    // NOT NULL columns that nothing reads.
    allowMcpServers: true,
    allowPackageManagers: true,
    createdAt: input.timestampMs,
    createdByAccountId: input.actorId,
    environmentId: input.environmentId,
    id: input.revisionId,
    networkPolicy: input.config.networkPolicy,
    projectId: input.projectId,
    setupScript: input.config.setupScript,
  };
}

export async function createRevision(
  bindings: Pick<ApiBindings, "DB">,
  input: {
    actorId: AccountId | null;
    config: EnvironmentMutableConfig;
    environmentId: EnvironmentId;
    projectId: ProjectId;
    timestampMs: number;
  },
): Promise<EnvironmentRevisionId> {
  const revisionId = createPlatformId<EnvironmentRevisionId>();

  await getAppDatabase(bindings.DB)
    .insert(environmentRevisionsTable)
    .values(toRevisionValues({ ...input, revisionId }))
    .run();

  return revisionId;
}

export async function createEnvironmentFromConfig(
  bindings: Pick<ApiBindings, "DB">,
  input: {
    actorId: AccountId | null;
    config: EnvironmentMutableConfig;
    description: string;
    environmentId: EnvironmentId;
    name: string;
    ownerId: AccountId | null;
    projectId: ProjectId;
    timestampMs: number;
  },
): Promise<void> {
  const revisionId = createPlatformId<EnvironmentRevisionId>();

  await runAppDatabaseBatch(bindings.DB, (db) => [
    db.insert(environmentsTable).values({
      createdAt: input.timestampMs,
      currentRevisionId: revisionId,
      description: input.description,
      id: input.environmentId,
      name: input.name,
      ownerAccountId: input.ownerId,
      projectId: input.projectId,
      updatedAt: input.timestampMs,
    }),
    db.insert(environmentRevisionsTable).values(toRevisionValues({ ...input, revisionId })),
  ]);
}
