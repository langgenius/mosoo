import type {
  OrganizationJoinPolicy,
  OrganizationMember,
  OrganizationMemberRole,
  OrganizationSummary,
  SetOrganizationMemberStatusInput,
  UpdateOrganizationJoinPolicyInput,
  UpdateOrganizationMemberRoleInput,
} from "@mosoo/contracts/organization";
import { Permission, can, canUpdateOrganizationMemberRole } from "@mosoo/contracts/permission";
import { accountsTable, organizationMembersTable, organizationsTable } from "@mosoo/db";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { and, asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../time";
import {
  appendAuditEvent,
  resolveViewerAuditActor,
} from "../../audit/application/audit-query.service";
import { AUDIT_ACTION, AUDIT_RESOURCE } from "../../audit/domain/audit-vocabulary";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  organizationSummaryColumns,
  toOrganizationMember,
  toOrganizationSummaryWithViewerRole,
} from "../domain/organization-access.policy";
import type { OrganizationMemberRow } from "../domain/organization-access.policy";
import { organizationKindValue } from "../domain/organization-kind.policy";
import { memberResourceDisplay } from "./organization-member-audit";

interface JoinPolicyUpdateContext {
  previousJoinPolicy: OrganizationJoinPolicy;
  viewerRole: OrganizationMemberRole;
}

interface OrganizationMemberMutationAdmission {
  actorRole: OrganizationMemberRole;
  target: OrganizationMember;
}

interface OrganizationMemberMutationAdmissionRow {
  actor_disabled_at: number | null;
  actor_role: OrganizationMemberRole;
  target_disabled_at: number | null;
  target_disabled_by_account_id: AccountId | null;
  target_email: string | null;
  target_id: AccountId | null;
  target_image_url: string | null;
  target_joined_at: number | null;
  target_name: string | null;
  target_role: OrganizationMemberRole | null;
}

interface OrganizationMemberListRow extends OrganizationMemberRow {
  viewer_disabled_at: number | null;
  viewer_role: OrganizationMemberRole;
}

const actorMembersTable = alias(organizationMembersTable, "actor_member");

function toOrganizationMemberMutationTarget(
  row: OrganizationMemberMutationAdmissionRow,
): OrganizationMember | null {
  if (
    row.target_email === null ||
    row.target_id === null ||
    row.target_joined_at === null ||
    row.target_name === null ||
    row.target_role === null
  ) {
    return null;
  }

  return toOrganizationMember({
    disabled_at: row.target_disabled_at,
    disabled_by_account_id: row.target_disabled_by_account_id,
    email: row.target_email,
    id: row.target_id,
    image_url: row.target_image_url,
    joined_at: row.target_joined_at,
    name: row.target_name,
    role: row.target_role,
  });
}

async function admitOrganizationMemberMutation(
  database: D1Database,
  input: {
    actorAccountId: AccountId;
    organizationId: OrganizationId;
    targetAccountId: AccountId;
  },
): Promise<OrganizationMemberMutationAdmission> {
  const row =
    (await getAppDatabase(database)
      .select({
        actor_disabled_at: actorMembersTable.disabledAt,
        actor_role: actorMembersTable.role,
        target_disabled_at: organizationMembersTable.disabledAt,
        target_disabled_by_account_id: organizationMembersTable.disabledByAccountId,
        target_email: accountsTable.email,
        target_id: accountsTable.id,
        target_image_url: accountsTable.image,
        target_joined_at: organizationMembersTable.joinedAt,
        target_name: accountsTable.name,
        target_role: organizationMembersTable.role,
      })
      .from(actorMembersTable)
      .leftJoin(
        organizationMembersTable,
        and(
          eq(organizationMembersTable.organizationId, actorMembersTable.organizationId),
          eq(organizationMembersTable.accountId, input.targetAccountId),
        ),
      )
      .leftJoin(accountsTable, eq(accountsTable.id, organizationMembersTable.accountId))
      .where(
        and(
          eq(actorMembersTable.accountId, input.actorAccountId),
          eq(actorMembersTable.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    throw new Error("Organization not found.");
  }

  if (row.actor_disabled_at !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  const target = toOrganizationMemberMutationTarget(row);
  if (!target) {
    throw new Error("Organization member not found.");
  }

  return {
    actorRole: row.actor_role,
    target,
  };
}

export async function listOrganizationMembers(
  database: D1Database,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<OrganizationMember[]> {
  const rows = await getAppDatabase(database)
    .select({
      disabled_at: organizationMembersTable.disabledAt,
      disabled_by_account_id: organizationMembersTable.disabledByAccountId,
      email: accountsTable.email,
      id: accountsTable.id,
      image_url: accountsTable.image,
      joined_at: organizationMembersTable.joinedAt,
      name: accountsTable.name,
      role: organizationMembersTable.role,
      viewer_disabled_at: actorMembersTable.disabledAt,
      viewer_role: actorMembersTable.role,
    })
    .from(actorMembersTable)
    .innerJoin(
      organizationMembersTable,
      eq(organizationMembersTable.organizationId, actorMembersTable.organizationId),
    )
    .innerJoin(accountsTable, eq(accountsTable.id, organizationMembersTable.accountId))
    .where(
      and(
        eq(actorMembersTable.accountId, viewer.id),
        eq(actorMembersTable.organizationId, organizationId),
      ),
    )
    .orderBy(asc(organizationMembersTable.joinedAt))
    .all();

  const first = rows[0] satisfies OrganizationMemberListRow | undefined;
  if (!first) {
    throw new Error("Organization not found.");
  }

  if (first.viewer_disabled_at !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  if (!can(first.viewer_role, Permission.MembersList)) {
    throw forbiddenError();
  }

  return rows.map((row: OrganizationMemberListRow) => toOrganizationMember(row));
}

export async function updateOrganizationMemberRole(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateOrganizationMemberRoleInput,
): Promise<OrganizationMember> {
  const admission = await admitOrganizationMemberMutation(database, {
    actorAccountId: viewer.id,
    organizationId: input.organizationId,
    targetAccountId: input.accountId,
  });

  if (
    !canUpdateOrganizationMemberRole({
      actorRole: admission.actorRole,
      nextRole: input.role,
      targetRole: admission.target.role,
    })
  ) {
    throw forbiddenError();
  }

  const updated =
    (await getAppDatabase(database)
      .update(organizationMembersTable)
      .set({ role: input.role })
      .where(
        and(
          eq(organizationMembersTable.organizationId, input.organizationId),
          eq(organizationMembersTable.accountId, input.accountId),
        ),
      )
      .returning({ accountId: organizationMembersTable.accountId })
      .get()) ?? null;

  if (updated === null) {
    throw new Error("Organization member not found.");
  }

  await appendAuditEvent(database, {
    action: AUDIT_ACTION.memberUpdate,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      actorOrganizationRole: admission.actorRole,
      kind: "role",
      previousRole: admission.target.role,
      role: input.role,
    },
    organizationId: input.organizationId,
    outcome: "success",
    resourceDisplay: memberResourceDisplay(admission.target),
    resourceId: input.accountId,
    resourceType: AUDIT_RESOURCE.member,
  });

  return {
    ...admission.target,
    role: input.role,
  };
}

function canSetOrganizationMemberStatus(input: {
  actorRole: "owner" | "admin" | "member";
  targetRole: "owner" | "admin" | "member";
}): boolean {
  if (input.actorRole === "owner") {
    return input.targetRole !== "owner";
  }

  if (input.actorRole === "admin") {
    return input.targetRole === "member";
  }

  return false;
}

async function admitJoinPolicyUpdate(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
): Promise<JoinPolicyUpdateContext> {
  const row =
    (await getAppDatabase(database)
      .select({
        disabled_at: organizationMembersTable.disabledAt,
        join_policy: organizationsTable.joinPolicy,
        kind: organizationKindValue(),
        role: organizationMembersTable.role,
      })
      .from(organizationMembersTable)
      .innerJoin(
        organizationsTable,
        eq(organizationsTable.id, organizationMembersTable.organizationId),
      )
      .where(
        and(
          eq(organizationMembersTable.accountId, viewerId),
          eq(organizationMembersTable.organizationId, organizationId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  const context = row satisfies {
    disabled_at: number | null;
    join_policy: OrganizationJoinPolicy;
    kind: OrganizationSummary["kind"];
    role: OrganizationMemberRole;
  } | null;

  if (!context) {
    throw new Error("Organization not found.");
  }

  if (context.disabled_at !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  if (!can(context.role, Permission.OrgSetJoinPolicy)) {
    throw forbiddenError();
  }

  if (context.kind === "personal") {
    throw new Error("Convert this Personal Org to collaborate with others.");
  }

  return {
    previousJoinPolicy: context.join_policy,
    viewerRole: context.role,
  };
}

export async function setOrganizationMemberStatus(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: SetOrganizationMemberStatusInput,
): Promise<OrganizationMember> {
  const admission = await admitOrganizationMemberMutation(database, {
    actorAccountId: viewer.id,
    organizationId: input.organizationId,
    targetAccountId: input.accountId,
  });

  if (input.accountId === viewer.id) {
    throw new Error("You cannot change your own membership status.");
  }

  if (
    !canSetOrganizationMemberStatus({
      actorRole: admission.actorRole,
      targetRole: admission.target.role,
    })
  ) {
    throw forbiddenError();
  }

  const disabledAtMs = input.status === "disabled" ? currentTimestampMs() : null;
  const disabledByAccountId = disabledAtMs === null ? null : viewer.id;
  const updated =
    (await getAppDatabase(database)
      .update(organizationMembersTable)
      .set({
        disabledAt: disabledAtMs,
        disabledByAccountId,
      })
      .where(
        and(
          eq(organizationMembersTable.organizationId, input.organizationId),
          eq(organizationMembersTable.accountId, input.accountId),
        ),
      )
      .returning({ accountId: organizationMembersTable.accountId })
      .get()) ?? null;

  if (updated === null) {
    throw new Error("Organization member not found.");
  }

  await appendAuditEvent(database, {
    action: AUDIT_ACTION.memberUpdate,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      actorOrganizationRole: admission.actorRole,
      kind: "status",
      previousStatus: admission.target.status,
      status: input.status,
    },
    organizationId: input.organizationId,
    outcome: "success",
    resourceDisplay: memberResourceDisplay(admission.target),
    resourceId: input.accountId,
    resourceType: AUDIT_RESOURCE.member,
  });

  return {
    ...admission.target,
    disabledAt: disabledAtMs === null ? null : toIsoString(disabledAtMs),
    disabledByAccountId,
    status: input.status,
  };
}

export async function updateJoinPolicy(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: UpdateOrganizationJoinPolicyInput,
): Promise<OrganizationSummary> {
  const context = await admitJoinPolicyUpdate(database, viewer.id, input.organizationId);

  const updated =
    (await getAppDatabase(database)
      .update(organizationsTable)
      .set({
        joinPolicy: input.joinPolicy,
        updatedAt: currentTimestampMs(),
      })
      .where(eq(organizationsTable.id, input.organizationId))
      .returning(organizationSummaryColumns())
      .get()) ?? null;

  if (updated === null) {
    throw new Error("Organization not found.");
  }

  await appendAuditEvent(database, {
    action: AUDIT_ACTION.orgSettingsUpdate,
    ...resolveViewerAuditActor(viewer),
    metadata: {
      kind: "join_policy",
      joinPolicy: input.joinPolicy,
      previousJoinPolicy: context.previousJoinPolicy,
    },
    organizationId: input.organizationId,
    outcome: "success",
    resourceDisplay: "Organization settings",
    resourceId: input.organizationId,
    resourceType: AUDIT_RESOURCE.orgSettings,
  });

  return toOrganizationSummaryWithViewerRole(updated, context.viewerRole);
}
