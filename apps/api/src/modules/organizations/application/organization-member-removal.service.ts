import { canRemoveOrganizationMember } from "@mosoo/contracts/permission";
import {
  accountsTable,
  agentMcpBindingsTable,
  agentsTable,
  environmentsTable,
  mcpCredentialsTable,
  mcpOauthFlowsTable,
  mcpServersTable,
  organizationMembersTable,
  organizationsTable,
  resourceAclTable,
  sessionsTable,
  skillPreferencesTable,
  skillsTable,
  spacesTable,
  vendorCredentialsTable,
} from "@mosoo/db";
import type { AccountId, OrganizationId, SessionId } from "@mosoo/id";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import {
  appendAuditEvent,
  resolveViewerAuditActor,
} from "../../audit/application/audit-query.service";
import { AUDIT_ACTION, AUDIT_RESOURCE } from "../../audit/domain/audit-vocabulary";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { memberResourceDisplay, membershipStatus } from "./organization-member-audit";

interface OrganizationMemberRemovalAdmission {
  actorRole: "admin" | "member" | "owner";
  target: {
    disabledAt: number | null;
    email: string | null;
    hasOwnedSessions: boolean;
    name: string | null;
    role: "admin" | "member" | "owner";
  };
}

const targetOrganizationMembersTable = alias(organizationMembersTable, "target_member");

async function admitOrganizationMemberRemoval(
  database: D1Database,
  organizationId: OrganizationId,
  actorAccountId: AccountId,
  accountId: AccountId,
): Promise<OrganizationMemberRemovalAdmission> {
  const row =
    (await getAppDatabase(database)
      .select({
        actorDisabledAt: organizationMembersTable.disabledAt,
        actorRole: organizationMembersTable.role,
        disabledAt: targetOrganizationMembersTable.disabledAt,
        email: accountsTable.email,
        name: accountsTable.name,
        role: targetOrganizationMembersTable.role,
        targetHasOwnedSessions: sql<number>`EXISTS (
          SELECT 1
          FROM ${sessionsTable}
          WHERE ${sessionsTable.organizationId} = ${organizationMembersTable.organizationId}
            AND ${sessionsTable.creatorAccountId} = ${targetOrganizationMembersTable.accountId}
        )`.mapWith(Number),
      })
      .from(organizationMembersTable)
      .innerJoin(
        organizationsTable,
        eq(organizationsTable.id, organizationMembersTable.organizationId),
      )
      .leftJoin(
        targetOrganizationMembersTable,
        and(
          eq(
            targetOrganizationMembersTable.organizationId,
            organizationMembersTable.organizationId,
          ),
          eq(targetOrganizationMembersTable.accountId, accountId),
        ),
      )
      .leftJoin(accountsTable, eq(accountsTable.id, targetOrganizationMembersTable.accountId))
      .where(
        and(
          eq(organizationMembersTable.organizationId, organizationId),
          eq(organizationMembersTable.accountId, actorAccountId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Organization not found.");
  }

  if (row.actorDisabledAt !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  if (row.role === null) {
    throw new Error("Organization member not found.");
  }

  return {
    actorRole: row.actorRole,
    target: {
      disabledAt: row.disabledAt,
      email: row.email,
      hasOwnedSessions: Boolean(row.targetHasOwnedSessions),
      name: row.name,
      role: row.role,
    },
  };
}

async function listMemberOwnedSessionIds(
  database: D1Database,
  organizationId: OrganizationId,
  accountId: AccountId,
): Promise<SessionId[]> {
  const sessions = await getAppDatabase(database)
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.organizationId, organizationId),
        eq(sessionsTable.creatorAccountId, accountId),
      ),
    )
    .all();

  return sessions.map((session) => session.id);
}

async function deleteMemberOwnedSessions(
  bindings: ApiBindings,
  organizationId: OrganizationId,
  accountId: AccountId,
): Promise<number> {
  const sessionIds = await listMemberOwnedSessionIds(bindings.DB, organizationId, accountId);

  if (sessionIds.length === 0) {
    return 0;
  }

  const { deleteSessionCascade } =
    await import("../../sessions/application/session-cleanup.service");

  for (const sessionId of sessionIds) {
    await deleteSessionCascade(bindings, sessionId);
  }

  return sessionIds.length;
}

async function cleanupMemberAccess(
  database: D1Database,
  organizationId: OrganizationId,
  accountId: AccountId,
): Promise<void> {
  await runAppDatabaseBatch(database, (db) => {
    const organizationAgentIds = db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.organizationId, organizationId));
    const organizationEnvironmentIds = db
      .select({ id: environmentsTable.id })
      .from(environmentsTable)
      .where(eq(environmentsTable.organizationId, organizationId));
    const organizationSkillIds = db
      .select({ id: skillsTable.id })
      .from(skillsTable)
      .where(eq(skillsTable.organizationId, organizationId));
    const organizationSpaceIds = db
      .select({ id: spacesTable.id })
      .from(spacesTable)
      .where(eq(spacesTable.organizationId, organizationId));
    const organizationMcpServerIds = db
      .select({ id: mcpServersTable.id })
      .from(mcpServersTable)
      .where(eq(mcpServersTable.organizationId, organizationId));
    const personalMcpServerIds = db
      .select({ id: mcpServersTable.id })
      .from(mcpServersTable)
      .where(
        and(
          eq(mcpServersTable.organizationId, organizationId),
          eq(mcpServersTable.ownerId, accountId),
          eq(mcpServersTable.source, "personal"),
        ),
      );
    const aclActorFilter = or(
      and(eq(resourceAclTable.targetKind, "user"), eq(resourceAclTable.targetId, accountId)),
      eq(resourceAclTable.assignedByAccountId, accountId),
    );
    const aclResourceFilter = or(
      and(
        eq(resourceAclTable.resourceType, "agent"),
        inArray(resourceAclTable.resourceId, organizationAgentIds),
      ),
      and(
        eq(resourceAclTable.resourceType, "environment"),
        inArray(resourceAclTable.resourceId, organizationEnvironmentIds),
      ),
      and(
        eq(resourceAclTable.resourceType, "skill"),
        inArray(resourceAclTable.resourceId, organizationSkillIds),
      ),
      and(
        eq(resourceAclTable.resourceType, "space"),
        inArray(resourceAclTable.resourceId, organizationSpaceIds),
      ),
    );

    if (!aclActorFilter || !aclResourceFilter) {
      throw new Error("Member access cleanup filters could not be built.");
    }

    return [
      db
        .delete(vendorCredentialsTable)
        .where(
          and(
            eq(vendorCredentialsTable.organizationId, organizationId),
            eq(vendorCredentialsTable.ownerAccountId, accountId),
          ),
        ),
      db.delete(resourceAclTable).where(and(aclActorFilter, aclResourceFilter)),
      db
        .delete(skillPreferencesTable)
        .where(
          and(
            eq(skillPreferencesTable.accountId, accountId),
            inArray(skillPreferencesTable.skillId, organizationSkillIds),
          ),
        ),
      db
        .delete(mcpOauthFlowsTable)
        .where(
          and(
            eq(mcpOauthFlowsTable.organizationId, organizationId),
            eq(mcpOauthFlowsTable.initiatorUserId, accountId),
          ),
        ),
      db
        .delete(mcpCredentialsTable)
        .where(
          and(
            eq(mcpCredentialsTable.accountId, accountId),
            inArray(mcpCredentialsTable.serverId, organizationMcpServerIds),
          ),
        ),
      db
        .delete(agentMcpBindingsTable)
        .where(inArray(agentMcpBindingsTable.serverId, personalMcpServerIds)),
      db
        .delete(mcpCredentialsTable)
        .where(inArray(mcpCredentialsTable.serverId, personalMcpServerIds)),
      db
        .delete(mcpServersTable)
        .where(
          and(
            eq(mcpServersTable.organizationId, organizationId),
            eq(mcpServersTable.ownerId, accountId),
            eq(mcpServersTable.source, "personal"),
          ),
        ),
    ];
  });
}

async function deleteOrganizationMembership(
  database: D1Database,
  organizationId: OrganizationId,
  accountId: AccountId,
): Promise<void> {
  await getAppDatabase(database)
    .delete(organizationMembersTable)
    .where(
      and(
        eq(organizationMembersTable.organizationId, organizationId),
        eq(organizationMembersTable.accountId, accountId),
      ),
    )
    .run();
}

export async function removeOrganizationMember(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
  accountId: AccountId,
): Promise<void> {
  const admission = await admitOrganizationMemberRemoval(
    bindings.DB,
    organizationId,
    viewer.id,
    accountId,
  );

  if (accountId === viewer.id) {
    throw new Error("You cannot remove yourself.");
  }

  if (
    !canRemoveOrganizationMember({
      actorRole: admission.actorRole,
      targetRole: admission.target.role,
    })
  ) {
    throw forbiddenError();
  }

  const deletedSessionCount = admission.target.hasOwnedSessions
    ? await deleteMemberOwnedSessions(bindings, organizationId, accountId)
    : 0;
  await cleanupMemberAccess(bindings.DB, organizationId, accountId);
  await deleteOrganizationMembership(bindings.DB, organizationId, accountId);

  await appendAuditEvent(bindings.DB, {
    action: AUDIT_ACTION.memberDelete,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      actorOrganizationRole: admission.actorRole,
      deletedSessionCount: String(deletedSessionCount),
      role: admission.target.role,
      status: membershipStatus(admission.target.disabledAt),
    },
    organizationId,
    outcome: "success",
    resourceDisplay: memberResourceDisplay(admission.target),
    resourceId: accountId,
    resourceType: AUDIT_RESOURCE.member,
  });
}
