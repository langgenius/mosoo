import type { OrganizationJoinPolicy, OrganizationMemberRole } from "@mosoo/contracts/organization";
import type {
  AccountId,
  EnvironmentId,
  OrganizationAccessRequestId,
  OrganizationId,
  OrganizationInvitationId,
  PlatformId,
} from "@mosoo/id";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { platformIdColumn } from "./id-column";

export const organizationsTable = sqliteTable(
  "organization",
  {
    avatarUrl: text("avatar_url"),
    byokAllowedProviders: text("byok_allowed_providers"),
    byokEnabled: integer("byok_enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    creatorAccountId: platformIdColumn<AccountId>("creator_account_id"),
    defaultEnvironmentId: platformIdColumn<EnvironmentId>("default_environment_id"),
    id: platformIdColumn<OrganizationId>("id").primaryKey(),
    joinPolicy: text("join_policy").$type<OrganizationJoinPolicy>().notNull(),
    name: text("name").notNull(),
    primaryDomain: text("primary_domain"),
    slug: text("slug").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("organization_primary_domain_idx").on(table.primaryDomain),
    uniqueIndex("organization_slug_idx").on(table.slug),
  ],
);

export const organizationDomainsTable = sqliteTable(
  "organization_domain",
  {
    createdAt: integer("created_at").notNull(),
    domain: text("domain").notNull(),
    id: platformIdColumn<PlatformId>("id").primaryKey(),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    status: text("status").$type<"active" | "pending" | "disabled">().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("organization_domain_domain_idx").on(table.domain),
    index("organization_domain_organization_id_idx").on(table.organizationId),
  ],
);

export const organizationMembersTable = sqliteTable(
  "organization_member",
  {
    accountId: platformIdColumn<AccountId>("account_id").notNull(),
    createdAt: integer("created_at").notNull(),
    disabledAt: integer("disabled_at"),
    disabledByAccountId: platformIdColumn<AccountId>("disabled_by_account_id"),
    joinedAt: integer("joined_at").notNull(),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    role: text("role").$type<OrganizationMemberRole>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.accountId],
    }),
  ],
);

export const organizationInvitationsTable = sqliteTable(
  "organization_invitation",
  {
    accountId: platformIdColumn<AccountId>("account_id"),
    createdAt: integer("created_at").notNull(),
    email: text("email").notNull(),
    expiresAt: integer("expires_at"),
    id: platformIdColumn<OrganizationInvitationId>("id").primaryKey(),
    invitedBy: platformIdColumn<AccountId>("invited_by").notNull(),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    status: text("status")
      .$type<"pending" | "accepted" | "rejected" | "cancelled" | "expired">()
      .notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("organization_invitation_organization_status_idx").on(table.organizationId, table.status),
    index("organization_invitation_email_status_created_idx").on(
      table.email,
      table.status,
      table.createdAt,
    ),
    uniqueIndex("organization_invitation_pending_email_idx")
      .on(table.organizationId, table.email)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export const organizationAccessRequestsTable = sqliteTable(
  "organization_access_request",
  {
    createdAt: integer("created_at").notNull(),
    id: platformIdColumn<OrganizationAccessRequestId>("id").primaryKey(),
    organizationId: platformIdColumn<OrganizationId>("organization_id").notNull(),
    referrerAccountId: platformIdColumn<AccountId>("referrer_account_id"),
    requestedByAccountId: platformIdColumn<AccountId>("requested_by_account_id").notNull(),
    requesterEmail: text("requester_email").notNull(),
    reviewedAt: integer("reviewed_at"),
    reviewedBy: platformIdColumn<AccountId>("reviewed_by"),
    status: text("status").$type<"pending" | "approved" | "rejected" | "cancelled">().notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("organization_access_request_organization_status_idx").on(
      table.organizationId,
      table.status,
    ),
    index("organization_access_request_requester_status_idx").on(
      table.requestedByAccountId,
      table.status,
    ),
    uniqueIndex("organization_access_request_pending_account_idx")
      .on(table.organizationId, table.requestedByAccountId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export type OrganizationAccessRequestRow = typeof organizationAccessRequestsTable.$inferSelect;
export type OrganizationDomainRow = typeof organizationDomainsTable.$inferSelect;
export type OrganizationInvitationRow = typeof organizationInvitationsTable.$inferSelect;
export type OrganizationMemberRow = typeof organizationMembersTable.$inferSelect;
export type OrganizationRow = typeof organizationsTable.$inferSelect;
