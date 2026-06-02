import type {
  OrganizationJoinPolicy,
  OrganizationMember,
  OrganizationMemberRole,
  OrganizationMemberStatus,
  OrganizationSummary,
} from "@mosoo/contracts/organization";
import type { Permission } from "@mosoo/contracts/permission";
import { Permission as PermissionId, can } from "@mosoo/contracts/permission";
import { organizationMembersTable, organizationsTable } from "@mosoo/db";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { and, eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError } from "../../../platform/errors";
import { toIsoString } from "../../../time";
import { organizationKindValue } from "./organization-kind.policy";

export interface OrganizationSummaryRow {
  avatar_url: string | null;
  created_at: number;
  id: OrganizationId;
  join_policy: OrganizationJoinPolicy;
  kind: OrganizationSummary["kind"];
  name: string;
  primary_domain: string | null;
  slug: string;
  viewer_role: OrganizationMemberRole | null;
}

export type OrganizationSummaryDataRow = Omit<OrganizationSummaryRow, "viewer_role">;

export interface OrganizationMemberRow {
  disabled_at: number | null;
  disabled_by_account_id: AccountId | null;
  email: string;
  id: AccountId;
  image_url: string | null;
  joined_at: number;
  name: string;
  role: OrganizationMemberRole;
}

export interface ViewerOrganizationMembership {
  joinPolicy: OrganizationJoinPolicy;
  organizationId: OrganizationId;
  role: OrganizationMemberRole;
}

export type CreatorMembershipStatus = "active" | "disabled" | "removed";

export function isOrganizationAdminRole(role: OrganizationMemberRole): boolean {
  return role === "owner" || role === "admin";
}

export function toOrganizationSummary(row: OrganizationSummaryRow): OrganizationSummary {
  return {
    avatarUrl: row.avatar_url,
    createdAt: toIsoString(row.created_at),
    id: row.id,
    joinPolicy: row.join_policy,
    kind: row.kind,
    name: row.name,
    primaryDomain: row.primary_domain,
    slug: row.slug,
    viewerRole: row.viewer_role,
  };
}

export function organizationSummaryColumns() {
  return {
    avatar_url: organizationsTable.avatarUrl,
    created_at: organizationsTable.createdAt,
    id: organizationsTable.id,
    join_policy: organizationsTable.joinPolicy,
    kind: organizationKindValue(),
    name: organizationsTable.name,
    primary_domain: organizationsTable.primaryDomain,
    slug: organizationsTable.slug,
  };
}

export function toOrganizationSummaryWithViewerRole(
  row: OrganizationSummaryDataRow,
  viewerRole: OrganizationMemberRole | null,
): OrganizationSummary {
  return toOrganizationSummary({
    ...row,
    viewer_role: viewerRole,
  });
}

export function toOrganizationMember(row: OrganizationMemberRow): OrganizationMember {
  const status: OrganizationMemberStatus = row.disabled_at === null ? "active" : "disabled";

  return {
    accountId: row.id,
    disabledAt: row.disabled_at === null ? null : toIsoString(row.disabled_at),
    disabledByAccountId: row.disabled_by_account_id,
    email: row.email,
    imageUrl: row.image_url,
    joinedAt: toIsoString(row.joined_at),
    name: row.name,
    role: row.role,
    status,
  };
}

export async function ensureOrganizationMembership(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
): Promise<ViewerOrganizationMembership> {
  const row =
    (await getAppDatabase(database)
      .select({
        disabled_at: organizationMembersTable.disabledAt,
        join_policy: organizationsTable.joinPolicy,
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

  const membership = row satisfies {
    join_policy: ViewerOrganizationMembership["joinPolicy"];
    disabled_at: number | null;
    role: ViewerOrganizationMembership["role"];
  } | null;

  if (!membership) {
    throw new Error("Organization not found.");
  }

  if (membership.disabled_at !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  return {
    joinPolicy: membership.join_policy,
    organizationId,
    role: membership.role,
  };
}

export async function ensureOrganizationPermission(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
  permission: Permission,
): Promise<ViewerOrganizationMembership> {
  const membership = await ensureOrganizationMembership(database, viewerId, organizationId);

  if (!can(membership.role, permission)) {
    throw forbiddenError();
  }

  return membership;
}

export async function ensureOrganizationAdmin(
  database: D1Database,
  viewerId: AccountId,
  organizationId: OrganizationId,
): Promise<ViewerOrganizationMembership> {
  return ensureOrganizationPermission(
    database,
    viewerId,
    organizationId,
    PermissionId.ProvidersCompanyManage,
  );
}

export async function getOrganizationSummary(
  database: D1Database,
  organizationId: OrganizationId,
): Promise<OrganizationSummary | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        ...organizationSummaryColumns(),
        viewer_role: sql<OrganizationMemberRole | null>`null`,
      })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, organizationId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return toOrganizationSummary(row);
}

export async function getOrganizationSummaryForActiveMember(
  database: D1Database,
  organizationId: OrganizationId,
  viewerId: AccountId,
): Promise<OrganizationSummary> {
  const row =
    (await getAppDatabase(database)
      .select({
        ...organizationSummaryColumns(),
        disabled_at: organizationMembersTable.disabledAt,
        viewer_role: organizationMembersTable.role,
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

  const membership = row satisfies (OrganizationSummaryRow & { disabled_at: number | null }) | null;

  if (!membership) {
    throw new Error("Organization not found.");
  }

  if (membership.disabled_at !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  return toOrganizationSummary(membership);
}
