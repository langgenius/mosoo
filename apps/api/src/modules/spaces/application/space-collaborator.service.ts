import type {
  AddCollaboratorInput,
  AddOrganizationCollaboratorInput,
  Collaborator,
  RemoveCollaboratorInput,
  UpdateCollaboratorInput,
} from "@mosoo/contracts/space";
import { accountsTable, organizationMembersTable, resourceAclTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, SpaceId } from "@mosoo/id";
import { and, asc, eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs, toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  deleteResourceAcl,
  insertResourceAclIfAbsent,
  principalToAclTarget,
  updateResourceAclRole,
} from "../../resource-access/application/resource-acl.service";
import { getAccountByEmail } from "../../users/domain/user-account.policy";
import { ensureSpaceAccess, ensureSpaceAclManager } from "../domain/space-access.policy";
import { updateSpaceVisibilityAfterCollaboratorChange } from "../domain/space-visibility.policy";
interface CollaboratorRow {
  assigned_by: AccountId | null;
  created_at: number;
  email: string | null;
  image_url: string | null;
  name: string | null;
  principal: string;
  role: Collaborator["role"];
}

function enforceOrganizationWildcardRole(principal: string, role: Collaborator["role"]): void {
  if (principal === "*" && role !== "read") {
    throw new Error("Everyone in organization can only be granted read access.");
  }
}

function parseCollaboratorPrincipal(principal: string, label: string): AccountId | "*" {
  return principal === "*" ? "*" : parsePlatformId(principal, label);
}

function toCollaborator(row: CollaboratorRow): Collaborator {
  enforceOrganizationWildcardRole(row.principal, row.role);

  return {
    assignedBy: row.assigned_by,
    createdAt: toIsoString(row.created_at),
    email: row.email,
    imageUrl: row.image_url,
    name: row.name,
    principal: row.principal,
    role: row.role,
  };
}

export async function getCollaborators(
  database: D1Database,
  viewer: AuthenticatedViewer,
  spaceId: SpaceId,
): Promise<Collaborator[]> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureSpaceAccess(database, viewerId, spaceId, "read");

  const results = await getAppDatabase(database)
    .select({
      assigned_by: resourceAclTable.assignedByAccountId,
      created_at: resourceAclTable.createdAt,
      email: accountsTable.email,
      image_url: accountsTable.image,
      name: accountsTable.name,
      principal: sql<string>`CASE ${resourceAclTable.targetKind}
        WHEN 'organization' THEN '*'
        ELSE ${resourceAclTable.targetId}
      END`,
      role: sql<Collaborator["role"]>`${resourceAclTable.role}`,
    })
    .from(resourceAclTable)
    .leftJoin(
      accountsTable,
      and(
        sql`${resourceAclTable.targetKind} = 'user'`,
        eq(accountsTable.id, resourceAclTable.targetId),
      ),
    )
    .where(
      and(eq(resourceAclTable.resourceType, "space"), eq(resourceAclTable.resourceId, spaceId)),
    )
    .orderBy(asc(resourceAclTable.createdAt))
    .all();

  return results.map(toCollaborator);
}

export async function addCollaborator(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: AddCollaboratorInput,
): Promise<Collaborator> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const space = await ensureSpaceAclManager(database, viewerId, input.spaceId);
  const timestampMs = currentTimestampMs();
  const invitedUser = await getAccountByEmail(database, input.email);

  if (invitedUser === null) {
    throw new Error("Account not found.");
  }
  const invitedUserId: AccountId = parsePlatformId(invitedUser.id, "collaborator account ID");

  const organizationMembership =
    (await getAppDatabase(database)
      .select({ account_id: organizationMembersTable.accountId })
      .from(organizationMembersTable)
      .where(
        and(
          eq(organizationMembersTable.organizationId, space.organization_id),
          eq(organizationMembersTable.accountId, invitedUserId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!organizationMembership) {
    throw new Error("A collaborator must be a organization member first.");
  }

  await insertResourceAclIfAbsent(database, {
    assignedByAccountId: viewerId,
    createdAt: timestampMs,
    resourceId: input.spaceId,
    resourceType: "space",
    role: input.role,
    target: principalToAclTarget(space.organization_id, invitedUserId),
  });

  await updateSpaceVisibilityAfterCollaboratorChange(database, input.spaceId);
  const collaborators = await getCollaborators(database, viewer, input.spaceId);
  const collaborator = collaborators.find((entry) => entry.principal === invitedUserId);

  if (!collaborator) {
    throw new Error("Collaborator not found.");
  }

  return collaborator;
}

export async function addOrganizationCollaborator(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: AddOrganizationCollaboratorInput,
): Promise<Collaborator> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const space = await ensureSpaceAclManager(database, viewerId, input.spaceId);
  const timestampMs = currentTimestampMs();

  await insertResourceAclIfAbsent(database, {
    assignedByAccountId: viewerId,
    createdAt: timestampMs,
    resourceId: input.spaceId,
    resourceType: "space",
    role: "read",
    target: principalToAclTarget(space.organization_id, "*"),
  });

  await updateSpaceVisibilityAfterCollaboratorChange(database, input.spaceId);
  const collaborators = await getCollaborators(database, viewer, input.spaceId);
  const collaborator = collaborators.find((entry) => entry.principal === "*");

  if (!collaborator) {
    throw new Error("Collaborator not found.");
  }

  return collaborator;
}

export async function updateCollaborator(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateCollaboratorInput,
): Promise<Collaborator> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const space = await ensureSpaceAclManager(database, viewerId, input.spaceId);

  if (input.userId === "*") {
    throw new Error("Use the organization-wide collaborator flow for Everyone in organization.");
  }
  const userId: AccountId = parsePlatformId(input.userId, "collaborator account ID");

  if (userId === space.owner_account_id) {
    throw new Error("Cannot change the space owner collaborator role.");
  }

  await updateResourceAclRole(database, {
    assignedByAccountId: viewerId,
    createdAt: currentTimestampMs(),
    resourceId: input.spaceId,
    resourceType: "space",
    role: input.role,
    target: principalToAclTarget(space.organization_id, userId),
  });

  const collaborators = await getCollaborators(database, viewer, input.spaceId);
  const collaborator = collaborators.find((entry) => entry.principal === userId);

  if (!collaborator) {
    throw new Error("Collaborator not found.");
  }

  return collaborator;
}

export async function removeCollaborator(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: RemoveCollaboratorInput,
): Promise<void> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  const space = await ensureSpaceAclManager(database, viewerId, input.spaceId);
  const principal = parseCollaboratorPrincipal(input.principal, "collaborator account ID");

  if (principal === space.owner_account_id) {
    throw new Error("Cannot remove the space owner.");
  }

  await deleteResourceAcl(database, {
    resourceId: input.spaceId,
    resourceType: "space",
    target: principalToAclTarget(space.organization_id, principal),
  });

  await updateSpaceVisibilityAfterCollaboratorChange(database, input.spaceId);
}
