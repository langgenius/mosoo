import {
  accountsTable,
  organizationAccessRequestsTable,
  organizationInvitationsTable,
  organizationMembersTable,
  organizationsTable,
} from "@mosoo/db";
import { eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { getAppDatabase } from "../../../platform/db/drizzle";

export const inviterAccountsTable = alias(accountsTable, "inviter");
export const inviteeAccountsTable = alias(accountsTable, "invitee");
export const inviteeMembersTable = alias(organizationMembersTable, "invitee_member");
export const referrerAccountsTable = alias(accountsTable, "referrer");
export const recipientAccountsTable = alias(accountsTable, "recipient");
export const recipientMembersTable = alias(organizationMembersTable, "recipient_member");
export const requesterAccountsTable = alias(accountsTable, "requester");
export const reviewerAccountsTable = alias(accountsTable, "reviewer");

export function requireJoinedValue<T>(value: T | null, field: string): T {
  if (value === null) {
    throw new Error(`${field} row is incomplete.`);
  }

  return value;
}

export function selectOrganizationInvitationRecords(database: D1Database) {
  return getAppDatabase(database)
    .select({
      account_id: organizationInvitationsTable.accountId,
      created_at: organizationInvitationsTable.createdAt,
      email: organizationInvitationsTable.email,
      expires_at: organizationInvitationsTable.expiresAt,
      id: organizationInvitationsTable.id,
      invited_by: organizationInvitationsTable.invitedBy,
      invited_by_name: sql`${inviterAccountsTable.name}`
        .mapWith(inviterAccountsTable.name)
        .as("invited_by_name"),
      organization_id: organizationInvitationsTable.organizationId,
      organization_name: sql`${organizationsTable.name}`
        .mapWith(organizationsTable.name)
        .as("organization_name"),
      status: organizationInvitationsTable.status,
      updated_at: organizationInvitationsTable.updatedAt,
    })
    .from(organizationInvitationsTable)
    .innerJoin(
      organizationsTable,
      eq(organizationsTable.id, organizationInvitationsTable.organizationId),
    )
    .leftJoin(
      inviterAccountsTable,
      eq(inviterAccountsTable.id, organizationInvitationsTable.invitedBy),
    );
}

export function selectOrganizationInvitationAcceptanceRecords(database: D1Database) {
  return getAppDatabase(database)
    .select({
      account_id: organizationInvitationsTable.accountId,
      created_at: organizationInvitationsTable.createdAt,
      email: organizationInvitationsTable.email,
      expires_at: organizationInvitationsTable.expiresAt,
      id: organizationInvitationsTable.id,
      invited_by: organizationInvitationsTable.invitedBy,
      invited_by_name: sql`${inviterAccountsTable.name}`
        .mapWith(inviterAccountsTable.name)
        .as("invited_by_name"),
      organization_avatar_url: organizationsTable.avatarUrl,
      organization_created_at: organizationsTable.createdAt,
      organization_id: organizationInvitationsTable.organizationId,
      organization_join_policy: organizationsTable.joinPolicy,
      organization_name: sql`${organizationsTable.name}`
        .mapWith(organizationsTable.name)
        .as("organization_name"),
      organization_primary_domain: organizationsTable.primaryDomain,
      organization_slug: organizationsTable.slug,
      status: organizationInvitationsTable.status,
      updated_at: organizationInvitationsTable.updatedAt,
    })
    .from(organizationInvitationsTable)
    .innerJoin(
      organizationsTable,
      eq(organizationsTable.id, organizationInvitationsTable.organizationId),
    )
    .leftJoin(
      inviterAccountsTable,
      eq(inviterAccountsTable.id, organizationInvitationsTable.invitedBy),
    );
}

export function organizationAccessRequestRecordColumns() {
  return {
    created_at: organizationAccessRequestsTable.createdAt,
    id: organizationAccessRequestsTable.id,
    organization_id: organizationAccessRequestsTable.organizationId,
    organization_name: sql`${organizationsTable.name}`
      .mapWith(organizationsTable.name)
      .as("organization_name"),
    referrer_account_id: organizationAccessRequestsTable.referrerAccountId,
    referrer_name: sql`${referrerAccountsTable.name}`
      .mapWith(referrerAccountsTable.name)
      .as("referrer_name"),
    requested_by_account_id: organizationAccessRequestsTable.requestedByAccountId,
    requester_email: organizationAccessRequestsTable.requesterEmail,
    requester_name: sql`${requesterAccountsTable.name}`
      .mapWith(requesterAccountsTable.name)
      .as("requester_name"),
    reviewed_at: organizationAccessRequestsTable.reviewedAt,
    reviewed_by: organizationAccessRequestsTable.reviewedBy,
    reviewed_by_name: sql`${reviewerAccountsTable.name}`
      .mapWith(reviewerAccountsTable.name)
      .as("reviewed_by_name"),
    status: organizationAccessRequestsTable.status,
    updated_at: organizationAccessRequestsTable.updatedAt,
  };
}

export function selectOrganizationAccessRequestRecords(database: D1Database) {
  return getAppDatabase(database)
    .select(organizationAccessRequestRecordColumns())
    .from(organizationAccessRequestsTable)
    .innerJoin(
      organizationsTable,
      eq(organizationsTable.id, organizationAccessRequestsTable.organizationId),
    )
    .innerJoin(
      requesterAccountsTable,
      eq(requesterAccountsTable.id, organizationAccessRequestsTable.requestedByAccountId),
    )
    .leftJoin(
      referrerAccountsTable,
      eq(referrerAccountsTable.id, organizationAccessRequestsTable.referrerAccountId),
    )
    .leftJoin(
      reviewerAccountsTable,
      eq(reviewerAccountsTable.id, organizationAccessRequestsTable.reviewedBy),
    );
}
