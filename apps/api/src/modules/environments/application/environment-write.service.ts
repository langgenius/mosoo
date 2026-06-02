import {
  environmentRevisionsTable,
  environmentsTable,
  organizationMembersTable,
  resourceAclTable,
} from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, EnvironmentId, EnvironmentRevisionId, OrganizationId } from "@mosoo/id";
import { and, eq, inArray, isNull } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import {
  buildStoredEnvVars,
  decryptEnvironmentVariables,
  serializeConfig,
} from "./environment-config";
import type { EnvironmentMutableConfig, EnvironmentRecordRow } from "./environment-types";

export async function createRevision(
  bindings: Pick<ApiBindings, "DB">,
  input: {
    actorId: AccountId | null;
    config: EnvironmentMutableConfig;
    environmentId: EnvironmentId;
    organizationId: OrganizationId;
    timestampMs: number;
  },
): Promise<EnvironmentRevisionId> {
  const revisionId = createPlatformId<EnvironmentRevisionId>();
  const serialized = serializeConfig(input.config);

  await getAppDatabase(bindings.DB)
    .insert(environmentRevisionsTable)
    .values({
      allowMcpServers: input.config.allowMcpServers,
      allowPackageManagers: input.config.allowPackageManagers,
      allowedHostsJson: serialized.allowedHostsJson,
      createdAt: input.timestampMs,
      createdByAccountId: input.actorId,
      envVarsJson: serialized.envVarsJson,
      environmentId: input.environmentId,
      id: revisionId,
      networkPolicy: input.config.networkPolicy,
      organizationId: input.organizationId,
      packagesJson: serialized.packagesJson,
      setupScript: input.config.setupScript,
    })
    .run();

  return revisionId;
}

export async function createEnvironmentFromConfig(
  bindings: Pick<ApiBindings, "DB">,
  input: {
    actorId: AccountId | null;
    config: EnvironmentMutableConfig;
    description: string;
    forkedFromEnvironmentId?: EnvironmentId | null;
    forkedFromEnvironmentName?: string | null;
    forkedFromOwnerName?: string | null;
    environmentId?: EnvironmentId;
    name: string;
    ownerId: AccountId | null;
    organizationId: OrganizationId;
    timestampMs: number;
  },
): Promise<EnvironmentId> {
  const environmentId = input.environmentId ?? createPlatformId<EnvironmentId>();
  const revisionId = createPlatformId<EnvironmentRevisionId>();
  const serialized = serializeConfig(input.config);

  await runAppDatabaseBatch(bindings.DB, (db) => [
    db.insert(environmentsTable).values({
      createdAt: input.timestampMs,
      currentRevisionId: revisionId,
      description: input.description,
      forkedFromEnvironmentId: input.forkedFromEnvironmentId ?? null,
      forkedFromEnvironmentName: input.forkedFromEnvironmentName ?? null,
      forkedFromOwnerName: input.forkedFromOwnerName ?? null,
      id: environmentId,
      name: input.name,
      organizationId: input.organizationId,
      ownerAccountId: input.ownerId,
      updatedAt: input.timestampMs,
    }),
    db.insert(environmentRevisionsTable).values({
      allowMcpServers: input.config.allowMcpServers,
      allowPackageManagers: input.config.allowPackageManagers,
      allowedHostsJson: serialized.allowedHostsJson,
      createdAt: input.timestampMs,
      createdByAccountId: input.actorId,
      envVarsJson: serialized.envVarsJson,
      environmentId,
      id: revisionId,
      networkPolicy: input.config.networkPolicy,
      organizationId: input.organizationId,
      packagesJson: serialized.packagesJson,
      setupScript: input.config.setupScript,
    }),
  ]);

  return environmentId;
}

function allocateCopyNameFromTaken(taken: ReadonlySet<string>, sourceName: string): string {
  let counter = 1;

  while (counter < 10_000) {
    const candidate = counter === 1 ? `${sourceName} copy` : `${sourceName} copy ${counter}`;

    if (!taken.has(candidate)) {
      return candidate;
    }

    counter += 1;
  }

  return `${sourceName} copy ${Date.now()}`;
}

export async function allocateCopyName(
  database: D1Database,
  organizationId: OrganizationId,
  ownerId: AccountId,
  sourceName: string,
): Promise<string> {
  const results = await getAppDatabase(database)
    .select({ name: environmentsTable.name })
    .from(environmentsTable)
    .where(
      and(
        eq(environmentsTable.organizationId, organizationId),
        eq(environmentsTable.ownerAccountId, ownerId),
      ),
    )
    .all();
  const taken = new Set(results.map((row) => row.name));
  return allocateCopyNameFromTaken(taken, sourceName);
}

export async function allocateCopyNamesByOwner(
  database: D1Database,
  organizationId: OrganizationId,
  ownerIds: readonly AccountId[],
  sourceName: string,
): Promise<Map<AccountId, string>> {
  const uniqueOwnerIds = [...new Set(ownerIds)];
  const namesByOwnerId = new Map<string, Set<string>>(
    uniqueOwnerIds.map((ownerId) => [ownerId, new Set<string>()]),
  );

  if (uniqueOwnerIds.length === 0) {
    return new Map();
  }

  const rows = await getAppDatabase(database)
    .select({
      name: environmentsTable.name,
      ownerId: environmentsTable.ownerAccountId,
    })
    .from(environmentsTable)
    .where(
      and(
        eq(environmentsTable.organizationId, organizationId),
        inArray(environmentsTable.ownerAccountId, uniqueOwnerIds),
      ),
    )
    .all();

  for (const row of rows) {
    if (row.ownerId === null) {
      continue;
    }

    namesByOwnerId.get(row.ownerId)?.add(row.name);
  }

  return new Map(
    uniqueOwnerIds.map((ownerId) => [
      ownerId,
      allocateCopyNameFromTaken(namesByOwnerId.get(ownerId) ?? new Set(), sourceName),
    ]),
  );
}

export async function cloneConfigWithNewSecrets(
  bindings: ApiBindings,
  input: {
    config: EnvironmentMutableConfig;
    environmentId: EnvironmentId;
  },
): Promise<EnvironmentMutableConfig> {
  const values = await decryptEnvironmentVariables(bindings, {
    environmentId: input.environmentId,
    envVars: input.config.envVars,
  });
  const envVars = await buildStoredEnvVars(bindings, {
    envVars: Object.entries(values).map(([key, value]) => ({ key, value })),
    environmentId: input.environmentId,
  });

  return {
    ...input.config,
    envVars,
  };
}

export async function collectCascadeForkUsers(
  database: D1Database,
  row: EnvironmentRecordRow,
): Promise<AccountId[]> {
  const userIds = new Set<AccountId>();
  const results = await getAppDatabase(database)
    .select({
      targetId: resourceAclTable.targetId,
      targetKind: resourceAclTable.targetKind,
    })
    .from(resourceAclTable)
    .where(
      and(
        eq(resourceAclTable.resourceType, "environment"),
        eq(resourceAclTable.resourceId, row.id),
      ),
    )
    .all();
  const includesOrganizationShare = results.some((share) => share.targetKind === "organization");

  for (const share of results) {
    if (share.targetKind === "user") {
      const targetUserId = parsePlatformId<AccountId>(
        share.targetId,
        "environment ACL target account ID",
      );

      if (targetUserId !== row.ownerId) {
        userIds.add(targetUserId);
      }
    }
  }

  if (includesOrganizationShare) {
    const members = await getAppDatabase(database)
      .select({ userId: organizationMembersTable.accountId })
      .from(organizationMembersTable)
      .where(
        and(
          eq(organizationMembersTable.organizationId, row.organizationId),
          isNull(organizationMembersTable.disabledAt),
        ),
      )
      .all();

    for (const member of members) {
      if (member.userId !== row.ownerId) {
        userIds.add(member.userId);
      }
    }
  }

  return [...userIds];
}
