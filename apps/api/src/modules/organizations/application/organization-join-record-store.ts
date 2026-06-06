import {
  organizationAccessRequestsTable,
  organizationDomainsTable,
  organizationInvitationsTable,
  organizationMembersTable,
  organizationsTable,
} from "@mosoo/db";
import type { AccountId, OrganizationId } from "@mosoo/id";
import { and, eq, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { normalizeEmail } from "../../users/domain/email-address";
import { organizationSummaryColumns } from "../domain/organization-access.policy";
import {
  inviterAccountsTable,
  referrerAccountsTable,
  requesterAccountsTable,
  requireJoinedValue,
  reviewerAccountsTable,
} from "./organization-access-record-query";
import type {
  OrganizationAccessSubmissionAdmissionRow,
  OrganizationJoinTargetSnapshot,
} from "./organization-access-record.types";

export async function getOrganizationAccessSubmissionAdmission(
  database: D1Database,
  input: {
    domain: string;
    email: string;
    organizationId: OrganizationId;
    viewerId: AccountId;
  },
): Promise<OrganizationAccessSubmissionAdmissionRow | null> {
  return (
    (await getAppDatabase(database)
      .select({
        active_domain_id: organizationDomainsTable.id,
        active_membership_account_id: organizationMembersTable.accountId,
        join_policy: organizationsTable.joinPolicy,
        organization_id: organizationsTable.id,
        organization_name: organizationsTable.name,
        pending_invitation_id: organizationInvitationsTable.id,
        pending_request_created_at: organizationAccessRequestsTable.createdAt,
        pending_request_id: organizationAccessRequestsTable.id,
        pending_request_referrer_account_id: organizationAccessRequestsTable.referrerAccountId,
        pending_request_referrer_name: sql`${referrerAccountsTable.name}`
          .mapWith(referrerAccountsTable.name)
          .as("pending_request_referrer_name"),
        pending_request_requester_email: organizationAccessRequestsTable.requesterEmail,
        pending_request_updated_at: organizationAccessRequestsTable.updatedAt,
        primary_domain: organizationsTable.primaryDomain,
      })
      .from(organizationsTable)
      .leftJoin(
        organizationMembersTable,
        and(
          eq(organizationMembersTable.organizationId, organizationsTable.id),
          eq(organizationMembersTable.accountId, input.viewerId),
          isNull(organizationMembersTable.disabledAt),
        ),
      )
      .leftJoin(
        organizationInvitationsTable,
        and(
          eq(organizationInvitationsTable.organizationId, organizationsTable.id),
          eq(organizationInvitationsTable.email, input.email),
          eq(organizationInvitationsTable.status, "pending"),
        ),
      )
      .leftJoin(
        organizationAccessRequestsTable,
        and(
          eq(organizationAccessRequestsTable.organizationId, organizationsTable.id),
          eq(organizationAccessRequestsTable.requestedByAccountId, input.viewerId),
          eq(organizationAccessRequestsTable.status, "pending"),
        ),
      )
      .leftJoin(
        referrerAccountsTable,
        eq(referrerAccountsTable.id, organizationAccessRequestsTable.referrerAccountId),
      )
      .leftJoin(
        organizationDomainsTable,
        and(
          eq(organizationDomainsTable.organizationId, organizationsTable.id),
          eq(organizationDomainsTable.domain, input.domain),
          eq(organizationDomainsTable.status, "active"),
        ),
      )
      .where(eq(organizationsTable.id, input.organizationId))
      .limit(1)
      .get()) ?? null
  );
}

export async function getOrganizationJoinTargetSnapshot(
  database: D1Database,
  input: {
    email: string;
    organizationId: OrganizationId;
    viewerId: AccountId;
  },
): Promise<OrganizationJoinTargetSnapshot | null> {
  const normalizedEmail = normalizeEmail(input.email);
  const row =
    (await getAppDatabase(database)
      .select({
        ...organizationSummaryColumns(),
        invitation_account_id: organizationInvitationsTable.accountId,
        invitation_created_at: organizationInvitationsTable.createdAt,
        invitation_email: organizationInvitationsTable.email,
        invitation_expires_at: organizationInvitationsTable.expiresAt,
        invitation_id: organizationInvitationsTable.id,
        invitation_invited_by: organizationInvitationsTable.invitedBy,
        invitation_invited_by_name: sql`${inviterAccountsTable.name}`
          .mapWith(inviterAccountsTable.name)
          .as("invitation_invited_by_name"),
        invitation_status: organizationInvitationsTable.status,
        invitation_updated_at: organizationInvitationsTable.updatedAt,
        request_created_at: organizationAccessRequestsTable.createdAt,
        request_id: organizationAccessRequestsTable.id,
        request_referrer_account_id: organizationAccessRequestsTable.referrerAccountId,
        request_referrer_name: sql`${referrerAccountsTable.name}`
          .mapWith(referrerAccountsTable.name)
          .as("request_referrer_name"),
        request_requested_by_account_id: organizationAccessRequestsTable.requestedByAccountId,
        request_requester_email: organizationAccessRequestsTable.requesterEmail,
        request_requester_name: sql`${requesterAccountsTable.name}`
          .mapWith(requesterAccountsTable.name)
          .as("request_requester_name"),
        request_reviewed_at: organizationAccessRequestsTable.reviewedAt,
        request_reviewed_by: organizationAccessRequestsTable.reviewedBy,
        request_reviewed_by_name: sql`${reviewerAccountsTable.name}`
          .mapWith(reviewerAccountsTable.name)
          .as("request_reviewed_by_name"),
        request_status: organizationAccessRequestsTable.status,
        request_updated_at: organizationAccessRequestsTable.updatedAt,
        viewer_role: organizationMembersTable.role,
      })
      .from(organizationsTable)
      .leftJoin(
        organizationMembersTable,
        and(
          eq(organizationMembersTable.organizationId, organizationsTable.id),
          eq(organizationMembersTable.accountId, input.viewerId),
          isNull(organizationMembersTable.disabledAt),
        ),
      )
      .leftJoin(
        organizationInvitationsTable,
        and(
          eq(organizationInvitationsTable.organizationId, organizationsTable.id),
          eq(organizationInvitationsTable.email, normalizedEmail),
          eq(organizationInvitationsTable.status, "pending"),
        ),
      )
      .leftJoin(
        inviterAccountsTable,
        eq(inviterAccountsTable.id, organizationInvitationsTable.invitedBy),
      )
      .leftJoin(
        organizationAccessRequestsTable,
        and(
          eq(organizationAccessRequestsTable.organizationId, organizationsTable.id),
          eq(organizationAccessRequestsTable.requestedByAccountId, input.viewerId),
          eq(organizationAccessRequestsTable.status, "pending"),
        ),
      )
      .leftJoin(
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
      )
      .where(eq(organizationsTable.id, input.organizationId))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    return null;
  }

  return {
    organization: row,
    pendingInvitation:
      row.invitation_id === null
        ? null
        : {
            account_id: row.invitation_account_id,
            created_at: requireJoinedValue(row.invitation_created_at, "Invitation"),
            email: requireJoinedValue(row.invitation_email, "Invitation"),
            expires_at: row.invitation_expires_at,
            id: row.invitation_id,
            invited_by: requireJoinedValue(row.invitation_invited_by, "Invitation"),
            invited_by_name: row.invitation_invited_by_name,
            organization_id: input.organizationId,
            organization_name: row.name,
            status: requireJoinedValue(row.invitation_status, "Invitation"),
            updated_at: requireJoinedValue(row.invitation_updated_at, "Invitation"),
          },
    pendingRequest:
      row.request_id === null
        ? null
        : {
            created_at: requireJoinedValue(row.request_created_at, "Access request"),
            id: row.request_id,
            organization_id: input.organizationId,
            organization_name: row.name,
            referrer_account_id: row.request_referrer_account_id,
            referrer_name: row.request_referrer_name,
            requested_by_account_id: requireJoinedValue(
              row.request_requested_by_account_id,
              "Access request",
            ),
            requester_email: requireJoinedValue(row.request_requester_email, "Access request"),
            requester_name: requireJoinedValue(row.request_requester_name, "Access request"),
            reviewed_at: row.request_reviewed_at,
            reviewed_by: row.request_reviewed_by,
            reviewed_by_name: row.request_reviewed_by_name,
            status: requireJoinedValue(row.request_status, "Access request"),
            updated_at: requireJoinedValue(row.request_updated_at, "Access request"),
          },
  };
}
