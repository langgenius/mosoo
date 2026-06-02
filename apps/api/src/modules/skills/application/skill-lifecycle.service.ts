import type { CreateSkillForkInput, SkillSummary } from "@mosoo/contracts/skill";
import {
  agentsTable,
  agentSkillsTable,
  organizationMembersTable,
  resourceAclTable,
  sessionsTable,
  sessionRunsTable,
  sessionRunSkillsTable,
  skillPreferencesTable,
  skillsTable,
} from "@mosoo/db";
import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, OrganizationId, SkillId } from "@mosoo/id";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { ensureSkillAccess, ensureSkillDestructiveManager } from "./skill-access.service";
import { getSkillSummary } from "./skill-query.service";
import type { SkillRegistryRow } from "./skill-types";
interface CascadeForkReference {
  forkSkillId: SkillId;
  forkSkillName: string;
  targetUserId: AccountId;
}

export async function createSkillFork(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: CreateSkillForkInput,
): Promise<SkillSummary> {
  const viewerId = viewer.id;
  const source = await ensureSkillAccess(database, viewerId, input.skillId);
  const timestampMs = currentTimestampMs();
  const skillId = createPlatformId<SkillId>();
  const forkName = await allocateCopyName(database, source.organizationId, viewerId, source.name);

  await getAppDatabase(database)
    .insert(skillsTable)
    .values({
      author: source.author,
      createdAt: timestampMs,
      currentSnapshotId: source.currentSnapshotId,
      description: source.description,
      forkedFromOwnerName: source.ownerName ?? source.author,
      forkedFromSkillId: source.id,
      forkedFromSkillName: source.name,
      id: skillId,
      name: forkName,
      organizationId: source.organizationId,
      ownerAccountId: viewerId,
      sourceKind: "user",
      updatedAt: timestampMs,
      version: null,
    })
    .run();

  return getSkillSummary(database, viewer, skillId);
}

export async function deleteOwnedSkill(
  database: D1Database,
  viewer: AuthenticatedViewer,
  skillId: SkillId,
): Promise<void> {
  const viewerId = viewer.id;
  const skill = await ensureSkillDestructiveManager(database, viewerId, skillId);
  const targetUserIds = await collectCascadeForkUsers(database, skill);
  const timestampMs = currentTimestampMs();
  const createdForks = await buildCascadeForkReferences(database, skill, targetUserIds);

  if (createdForks.length > 0) {
    await getAppDatabase(database)
      .insert(skillsTable)
      .values(
        createdForks.map((fork) => ({
          author: skill.author,
          createdAt: timestampMs,
          currentSnapshotId: skill.currentSnapshotId,
          description: skill.description,
          forkedFromOwnerName: skill.ownerName ?? skill.author,
          forkedFromSkillId: skill.id,
          forkedFromSkillName: skill.name,
          id: fork.forkSkillId,
          name: fork.forkSkillName,
          organizationId: skill.organizationId,
          ownerAccountId: fork.targetUserId,
          sourceKind: "user" as const,
          updatedAt: timestampMs,
          version: null,
        })),
      )
      .run();
  }

  await copySkillPreferencesToForks(database, {
    createdAt: timestampMs,
    forks: createdForks,
    sourceSkillId: skill.id,
    updatedAt: timestampMs,
  });

  for (const fork of createdForks) {
    await remapUserOwnedAgentSkillReferences(database, {
      forkSkillId: fork.forkSkillId,
      sourceSkill: skill,
      targetUserId: fork.targetUserId,
    });
    await remapUserOwnedSessionRunSkillReferences(database, {
      forkSkillId: fork.forkSkillId,
      forkSkillName: fork.forkSkillName,
      sourceSkill: skill,
      targetUserId: fork.targetUserId,
    });
  }

  await getAppDatabase(database)
    .delete(resourceAclTable)
    .where(
      and(eq(resourceAclTable.resourceType, "skill"), eq(resourceAclTable.resourceId, skillId)),
    )
    .run();
  await getAppDatabase(database)
    .delete(skillPreferencesTable)
    .where(eq(skillPreferencesTable.skillId, skillId))
    .run();
  await getAppDatabase(database).delete(skillsTable).where(eq(skillsTable.id, skillId)).run();
}

async function copySkillPreferencesToForks(
  database: D1Database,
  input: {
    createdAt: number;
    forks: readonly CascadeForkReference[];
    sourceSkillId: SkillId;
    updatedAt: number;
  },
): Promise<void> {
  if (input.forks.length === 0) {
    return;
  }

  const db = getAppDatabase(database);
  const forkByUser = new Map(input.forks.map((fork) => [fork.targetUserId, fork]));
  const preferences = await db
    .select({
      autoEnabled: skillPreferencesTable.autoEnabled,
      userId: skillPreferencesTable.accountId,
    })
    .from(skillPreferencesTable)
    .where(
      and(
        eq(skillPreferencesTable.skillId, input.sourceSkillId),
        inArray(
          skillPreferencesTable.accountId,
          input.forks.map((fork) => fork.targetUserId),
        ),
      ),
    )
    .all();
  const values: (typeof skillPreferencesTable.$inferInsert)[] = [];

  for (const preference of preferences) {
    const fork = forkByUser.get(preference.userId);

    if (fork) {
      values.push({
        accountId: preference.userId,
        autoEnabled: preference.autoEnabled,
        createdAt: input.createdAt,
        skillId: fork.forkSkillId,
        updatedAt: input.updatedAt,
      });
    }
  }

  if (values.length === 0) {
    return;
  }

  await db
    .insert(skillPreferencesTable)
    .values(values)
    .onConflictDoUpdate({
      set: {
        autoEnabled: sql`excluded.auto_enabled`,
        updatedAt: sql`excluded.updated_at`,
      },
      target: [skillPreferencesTable.skillId, skillPreferencesTable.accountId],
    })
    .run();
}

async function remapUserOwnedAgentSkillReferences(
  database: D1Database,
  input: {
    forkSkillId: SkillId;
    sourceSkill: SkillRegistryRow;
    targetUserId: AccountId;
  },
): Promise<void> {
  const db = getAppDatabase(database);
  const userOwnedAgentIds = db
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(
      and(
        eq(agentsTable.ownerId, input.targetUserId),
        eq(agentsTable.organizationId, input.sourceSkill.organizationId),
      ),
    );

  await db
    .update(agentSkillsTable)
    .set({ skillId: input.forkSkillId })
    .where(
      and(
        eq(agentSkillsTable.skillId, input.sourceSkill.id),
        inArray(agentSkillsTable.agentId, userOwnedAgentIds),
      ),
    )
    .run();
}

async function remapUserOwnedSessionRunSkillReferences(
  database: D1Database,
  input: {
    forkSkillId: SkillId;
    forkSkillName: string;
    sourceSkill: SkillRegistryRow;
    targetUserId: AccountId;
  },
): Promise<void> {
  const db = getAppDatabase(database);
  const userOwnedSessionRunIds = db
    .select({ id: sessionRunsTable.id })
    .from(sessionRunsTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
    .where(
      and(
        eq(sessionsTable.creatorAccountId, input.targetUserId),
        eq(sessionsTable.organizationId, input.sourceSkill.organizationId),
      ),
    );

  await db
    .update(sessionRunSkillsTable)
    .set({
      skillId: input.forkSkillId,
      skillName: input.forkSkillName,
      snapshotId: input.sourceSkill.currentSnapshotId,
    })
    .where(
      and(
        eq(sessionRunSkillsTable.skillId, input.sourceSkill.id),
        inArray(sessionRunSkillsTable.sessionRunId, userOwnedSessionRunIds),
      ),
    )
    .run();
}

async function collectCascadeForkUsers(
  database: D1Database,
  skill: SkillRegistryRow,
): Promise<AccountId[]> {
  const userIds = new Set<AccountId>();
  const directShares = await getAppDatabase(database)
    .select({
      targetId: resourceAclTable.targetId,
      targetKind: resourceAclTable.targetKind,
    })
    .from(resourceAclTable)
    .where(
      and(eq(resourceAclTable.resourceType, "skill"), eq(resourceAclTable.resourceId, skill.id)),
    )
    .all();
  const organizationShareIds = [
    ...new Set(
      directShares
        .filter((share) => share.targetKind === "organization")
        .map((share) => parsePlatformId<OrganizationId>(share.targetId, "shared organization ID")),
    ),
  ];

  for (const share of directShares) {
    if (share.targetKind === "user") {
      if (share.targetId !== skill.ownerId) {
        userIds.add(parsePlatformId<AccountId>(share.targetId, "shared account ID"));
      }
    }
  }

  if (organizationShareIds.length > 0) {
    const members = await getAppDatabase(database)
      .select({
        userId: organizationMembersTable.accountId,
      })
      .from(organizationMembersTable)
      .where(
        and(
          inArray(organizationMembersTable.organizationId, organizationShareIds),
          isNull(organizationMembersTable.disabledAt),
        ),
      )
      .all();

    for (const member of members) {
      if (member.userId !== skill.ownerId) {
        userIds.add(member.userId);
      }
    }
  }

  return [...userIds];
}

async function allocateCopyName(
  database: D1Database,
  organizationId: OrganizationId,
  ownerId: AccountId,
  sourceName: string,
): Promise<string> {
  const taken = await listTakenSkillNames(database, organizationId, [ownerId]);
  return allocateCopyNameFromTaken(taken.get(ownerId) ?? new Set(), sourceName);
}

async function buildCascadeForkReferences(
  database: D1Database,
  skill: SkillRegistryRow,
  targetUserIds: readonly AccountId[],
): Promise<CascadeForkReference[]> {
  if (targetUserIds.length === 0) {
    return [];
  }

  const namesByOwner = await listTakenSkillNames(database, skill.organizationId, targetUserIds);

  return targetUserIds.map((targetUserId) => {
    const taken = namesByOwner.get(targetUserId) ?? new Set();
    const forkName = allocateCopyNameFromTaken(taken, skill.name);
    taken.add(forkName);
    namesByOwner.set(targetUserId, taken);

    return {
      forkSkillId: createPlatformId<SkillId>(),
      forkSkillName: forkName,
      targetUserId,
    };
  });
}

async function listTakenSkillNames(
  database: D1Database,
  organizationId: OrganizationId,
  ownerIds: readonly AccountId[],
): Promise<Map<AccountId, Set<string>>> {
  if (ownerIds.length === 0) {
    return new Map();
  }

  const rows = await getAppDatabase(database)
    .select({
      name: skillsTable.name,
      ownerId: skillsTable.ownerAccountId,
    })
    .from(skillsTable)
    .where(
      and(
        eq(skillsTable.organizationId, organizationId),
        inArray(skillsTable.ownerAccountId, ownerIds),
      ),
    )
    .all();
  const namesByOwner = new Map<AccountId, Set<string>>();

  for (const row of rows) {
    const names = namesByOwner.get(row.ownerId) ?? new Set<string>();
    names.add(row.name);
    namesByOwner.set(row.ownerId, names);
  }

  return namesByOwner;
}

function allocateCopyNameFromTaken(taken: Set<string>, sourceName: string): string {
  const parsed = parseCopySuffix(sourceName);
  let counter = parsed.nextCounter;

  while (counter < 10_000) {
    const candidate =
      counter === 1 ? `${parsed.baseName} copy` : `${parsed.baseName} copy ${counter}`;

    if (!taken.has(candidate)) {
      return candidate;
    }

    counter += 1;
  }

  return `${parsed.baseName} copy ${Date.now()}`;
}

function parseCopySuffix(sourceName: string): { baseName: string; nextCounter: number } {
  const match = /^(.*) copy(?: (\d+))?$/.exec(sourceName);

  if (!match) {
    return {
      baseName: sourceName,
      nextCounter: 1,
    };
  }

  const baseName = match[1]!.trim();
  const currentCounter = isTruthy(match[2]) ? Number.parseInt(match[2], 10) : 1;

  return {
    baseName,
    nextCounter: currentCounter + 1,
  };
}
