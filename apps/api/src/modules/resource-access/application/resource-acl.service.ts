import {
  agentsTable,
  environmentsTable,
  organizationMembersTable,
  resourceAclTable,
  skillsTable,
  spacesTable,
} from "@mosoo/db";
import type {
  ResourceAclResourceId,
  ResourceAclResourceType,
  ResourceAclTargetId,
  ResourceAclTargetKind,
} from "@mosoo/db";
import type {
  AccountId,
  AgentId,
  EnvironmentId,
  OrganizationId,
  SkillId,
  SpaceId,
} from "@mosoo/id";
import { and, eq, isNull } from "drizzle-orm";

import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";

export type ResourceAclTarget =
  | {
      targetId: AccountId;
      targetKind: "user";
    }
  | {
      targetId: OrganizationId;
      targetKind: "organization";
    };

export interface ResourceAclInputTarget {
  targetId: ResourceAclTargetId;
  targetKind: ResourceAclTargetKind;
}

export interface ResourceAclAssignmentKey {
  resourceId: ResourceAclResourceId;
  resourceType: ResourceAclResourceType;
  target: ResourceAclInputTarget | ResourceAclTarget;
}

export interface ResourceAclAssignmentInput extends ResourceAclAssignmentKey {
  assignedByAccountId?: AccountId | null;
  createdAt: number;
  role: string;
}

export interface ResourceAclAssignmentMetadata {
  assignedByAccountId: AccountId | null;
  createdAt: number;
}

function resourceAclKeyCondition(input: ResourceAclAssignmentKey) {
  return and(
    eq(resourceAclTable.resourceType, input.resourceType),
    eq(resourceAclTable.resourceId, input.resourceId),
    eq(resourceAclTable.targetKind, input.target.targetKind),
    eq(resourceAclTable.targetId, input.target.targetId),
  );
}

export function toOrganizationAclTarget(organizationId: OrganizationId): ResourceAclTarget {
  return {
    targetId: organizationId,
    targetKind: "organization",
  };
}

export function toUserAclTarget(accountId: AccountId): ResourceAclTarget {
  return {
    targetId: accountId,
    targetKind: "user",
  };
}

export function principalToAclTarget(
  organizationId: OrganizationId,
  principal: AccountId | "*",
): ResourceAclTarget {
  return principal === "*" ? toOrganizationAclTarget(organizationId) : toUserAclTarget(principal);
}

async function getAclResourceOrganizationId(
  database: D1Database,
  input: Pick<ResourceAclAssignmentKey, "resourceId" | "resourceType">,
): Promise<OrganizationId> {
  const db = getAppDatabase(database);

  if (input.resourceType === "agent") {
    const row =
      (await db
        .select({ organizationId: agentsTable.organizationId })
        .from(agentsTable)
        .where(eq(agentsTable.id, input.resourceId as AgentId))
        .limit(1)
        .get()) ?? null;

    if (row !== null) {
      return row.organizationId;
    }
  }

  if (input.resourceType === "environment") {
    const row =
      (await db
        .select({ organizationId: environmentsTable.organizationId })
        .from(environmentsTable)
        .where(eq(environmentsTable.id, input.resourceId as EnvironmentId))
        .limit(1)
        .get()) ?? null;

    if (row !== null) {
      return row.organizationId;
    }
  }

  if (input.resourceType === "skill") {
    const row =
      (await db
        .select({ organizationId: skillsTable.organizationId })
        .from(skillsTable)
        .where(eq(skillsTable.id, input.resourceId as SkillId))
        .limit(1)
        .get()) ?? null;

    if (row !== null) {
      return row.organizationId;
    }
  }

  if (input.resourceType === "space") {
    const row =
      (await db
        .select({ organizationId: spacesTable.organizationId })
        .from(spacesTable)
        .where(eq(spacesTable.id, input.resourceId as SpaceId))
        .limit(1)
        .get()) ?? null;

    if (row !== null) {
      return row.organizationId;
    }
  }

  throw validationError("ACL resource was not found.");
}

async function ensureWritableAclTarget(
  database: D1Database,
  input: ResourceAclAssignmentKey,
): Promise<void> {
  const organizationId = await getAclResourceOrganizationId(database, input);

  if (input.target.targetKind === "organization") {
    if (input.target.targetId !== organizationId) {
      throw validationError("Organization ACL target must match the resource organization.");
    }

    return;
  }

  const row =
    (await getAppDatabase(database)
      .select({ accountId: organizationMembersTable.accountId })
      .from(organizationMembersTable)
      .where(
        and(
          eq(organizationMembersTable.organizationId, organizationId),
          eq(organizationMembersTable.accountId, input.target.targetId as AccountId),
          isNull(organizationMembersTable.disabledAt),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw validationError("User ACL target must be an active member of the resource organization.");
  }
}

export async function insertResourceAclIfAbsent(
  database: D1Database,
  input: ResourceAclAssignmentInput,
): Promise<ResourceAclAssignmentMetadata> {
  await ensureWritableAclTarget(database, input);
  const db = getAppDatabase(database);

  const inserted =
    (await db
      .insert(resourceAclTable)
      .values({
        assignedByAccountId: input.assignedByAccountId ?? null,
        createdAt: input.createdAt,
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        role: input.role,
        targetId: input.target.targetId,
        targetKind: input.target.targetKind,
      })
      .onConflictDoNothing({
        target: [
          resourceAclTable.resourceType,
          resourceAclTable.resourceId,
          resourceAclTable.targetKind,
          resourceAclTable.targetId,
        ],
      })
      .returning({
        assignedByAccountId: resourceAclTable.assignedByAccountId,
        createdAt: resourceAclTable.createdAt,
      })
      .get()) ?? null;

  if (inserted !== null) {
    return inserted;
  }

  const row =
    (await db
      .select({
        assignedByAccountId: resourceAclTable.assignedByAccountId,
        createdAt: resourceAclTable.createdAt,
      })
      .from(resourceAclTable)
      .where(resourceAclKeyCondition(input))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Resource ACL assignment was not persisted.");
  }

  return row;
}

export async function updateResourceAclRole(
  database: D1Database,
  input: {
    assignedByAccountId?: AccountId | null;
    createdAt: number;
    resourceId: ResourceAclResourceId;
    resourceType: ResourceAclResourceType;
    role: string;
    target: ResourceAclTarget;
  },
): Promise<void> {
  await ensureWritableAclTarget(database, input);

  const result = await getAppDatabase(database)
    .update(resourceAclTable)
    .set({
      assignedByAccountId: input.assignedByAccountId ?? null,
      createdAt: input.createdAt,
      role: input.role,
    })
    .where(resourceAclKeyCondition(input))
    .run();

  if (getD1ChangeCount(result) === 0) {
    throw new Error("Resource ACL assignment not found.");
  }
}

export async function deleteResourceAcl(
  database: D1Database,
  input: ResourceAclAssignmentKey,
): Promise<void> {
  const result = await getAppDatabase(database)
    .delete(resourceAclTable)
    .where(resourceAclKeyCondition(input))
    .run();

  if (getD1ChangeCount(result) === 0) {
    throw new Error("Resource ACL assignment not found.");
  }
}
