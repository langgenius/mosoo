import {
  organizationAccessRequestsTable,
  organizationInvitationsTable,
  organizationMembersTable,
  organizationsTable,
} from "@mosoo/db";
import type { AccountId, OrganizationId, OrganizationInvitationId } from "@mosoo/id";
import { and, desc, eq, isNull, notExists, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { normalizeEmail } from "../../users/domain/email-address";
import { organizationKindValue } from "../domain/organization-kind.policy";
import {
  inviteeAccountsTable,
  inviteeMembersTable,
  inviterAccountsTable,
  recipientAccountsTable,
  recipientMembersTable,
  referrerAccountsTable,
  selectOrganizationInvitationAcceptanceRecords,
  selectOrganizationInvitationRecords,
} from "./organization-access-record-query";
import type {
  OrganizationInvitationAcceptanceRow,
  OrganizationInvitationCancellationAdmissionRow,
  OrganizationInvitationListAdmissionRow,
  OrganizationInvitationRequestAdmissionRow,
  OrganizationInvitationRow,
  OrganizationInviteMemberAdmissionRow,
} from "./organization-access-record.types";

export async function getOrganizationInvitationCancellationAdmission(
  database: D1Database,
  input: {
    invitationId: OrganizationInvitationId;
    viewerId: AccountId;
  },
): Promise<OrganizationInvitationCancellationAdmissionRow | null> {
  return (
    (await getAppDatabase(database)
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
        viewer_disabled_at: organizationMembersTable.disabledAt,
        viewer_role: organizationMembersTable.role,
      })
      .from(organizationInvitationsTable)
      .innerJoin(
        organizationsTable,
        eq(organizationsTable.id, organizationInvitationsTable.organizationId),
      )
      .leftJoin(
        inviterAccountsTable,
        eq(inviterAccountsTable.id, organizationInvitationsTable.invitedBy),
      )
      .leftJoin(
        organizationMembersTable,
        and(
          eq(organizationMembersTable.organizationId, organizationInvitationsTable.organizationId),
          eq(organizationMembersTable.accountId, input.viewerId),
        ),
      )
      .where(eq(organizationInvitationsTable.id, input.invitationId))
      .limit(1)
      .get()) ?? null
  );
}

export async function getOrganizationInvitationAcceptanceRecordById(
  database: D1Database,
  invitationId: OrganizationInvitationId,
): Promise<OrganizationInvitationAcceptanceRow | null> {
  return (
    (await selectOrganizationInvitationAcceptanceRecords(database)
      .where(eq(organizationInvitationsTable.id, invitationId))
      .limit(1)
      .get()) ?? null
  );
}

export async function getOrganizationInvitationRequestAdmission(
  database: D1Database,
  input: {
    email: string;
    organizationId: OrganizationId;
    viewerId: AccountId;
  },
): Promise<OrganizationInvitationRequestAdmissionRow | null> {
  return (
    (await getAppDatabase(database)
      .select({
        invitee_active_membership_account_id: inviteeMembersTable.accountId,
        invitee_id: inviteeAccountsTable.id,
        invitee_name: inviteeAccountsTable.name,
        kind: organizationKindValue(),
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
        viewer_disabled_at: organizationMembersTable.disabledAt,
        viewer_role: organizationMembersTable.role,
      })
      .from(organizationMembersTable)
      .innerJoin(
        organizationsTable,
        eq(organizationsTable.id, organizationMembersTable.organizationId),
      )
      .leftJoin(inviteeAccountsTable, eq(inviteeAccountsTable.email, input.email))
      .leftJoin(
        inviteeMembersTable,
        and(
          eq(inviteeMembersTable.organizationId, organizationsTable.id),
          eq(inviteeMembersTable.accountId, inviteeAccountsTable.id),
          isNull(inviteeMembersTable.disabledAt),
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
          eq(organizationAccessRequestsTable.requestedByAccountId, inviteeAccountsTable.id),
          eq(organizationAccessRequestsTable.status, "pending"),
        ),
      )
      .leftJoin(
        referrerAccountsTable,
        eq(referrerAccountsTable.id, organizationAccessRequestsTable.referrerAccountId),
      )
      .where(
        and(
          eq(organizationMembersTable.accountId, input.viewerId),
          eq(organizationMembersTable.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

export async function getPendingOrganizationInvitationRecordByEmail(
  database: D1Database,
  organizationId: OrganizationId,
  email: string,
): Promise<OrganizationInvitationRow | null> {
  const normalizedEmail = normalizeEmail(email);

  return (
    (await selectOrganizationInvitationRecords(database)
      .where(
        and(
          eq(organizationInvitationsTable.organizationId, organizationId),
          eq(organizationInvitationsTable.email, normalizedEmail),
          eq(organizationInvitationsTable.status, "pending"),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

export async function listPendingOrganizationInvitationRecordsForViewer(
  database: D1Database,
  input: {
    organizationId: OrganizationId;
    viewerId: AccountId;
  },
): Promise<OrganizationInvitationListAdmissionRow[]> {
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
      organization_id: organizationsTable.id,
      organization_name: organizationsTable.name,
      status: organizationInvitationsTable.status,
      updated_at: organizationInvitationsTable.updatedAt,
      viewer_disabled_at: organizationMembersTable.disabledAt,
      viewer_role: organizationMembersTable.role,
    })
    .from(organizationMembersTable)
    .innerJoin(
      organizationsTable,
      eq(organizationsTable.id, organizationMembersTable.organizationId),
    )
    .leftJoin(
      organizationInvitationsTable,
      and(
        eq(organizationInvitationsTable.organizationId, organizationsTable.id),
        eq(organizationInvitationsTable.status, "pending"),
      ),
    )
    .leftJoin(
      inviterAccountsTable,
      eq(inviterAccountsTable.id, organizationInvitationsTable.invitedBy),
    )
    .where(
      and(
        eq(organizationMembersTable.accountId, input.viewerId),
        eq(organizationMembersTable.organizationId, input.organizationId),
      ),
    )
    .orderBy(desc(organizationInvitationsTable.id))
    .all();
}

export async function getOrganizationInviteMemberAdmission(
  database: D1Database,
  input: {
    email: string;
    organizationId: OrganizationId;
    viewerId: AccountId;
  },
): Promise<OrganizationInviteMemberAdmissionRow | null> {
  return (
    (await getAppDatabase(database)
      .select({
        account_id: organizationInvitationsTable.accountId,
        created_at: organizationInvitationsTable.createdAt,
        email: organizationInvitationsTable.email,
        existing_member_account_id: recipientMembersTable.accountId,
        expires_at: organizationInvitationsTable.expiresAt,
        id: organizationInvitationsTable.id,
        invited_by: organizationInvitationsTable.invitedBy,
        invited_by_name: sql`${inviterAccountsTable.name}`
          .mapWith(inviterAccountsTable.name)
          .as("invited_by_name"),
        kind: organizationKindValue(),
        organization_id: organizationsTable.id,
        organization_name: organizationsTable.name,
        status: organizationInvitationsTable.status,
        updated_at: organizationInvitationsTable.updatedAt,
        viewer_disabled_at: organizationMembersTable.disabledAt,
        viewer_role: organizationMembersTable.role,
      })
      .from(organizationMembersTable)
      .innerJoin(
        organizationsTable,
        eq(organizationsTable.id, organizationMembersTable.organizationId),
      )
      .leftJoin(recipientAccountsTable, eq(recipientAccountsTable.email, input.email))
      .leftJoin(
        recipientMembersTable,
        and(
          eq(recipientMembersTable.organizationId, organizationsTable.id),
          eq(recipientMembersTable.accountId, recipientAccountsTable.id),
          isNull(recipientMembersTable.disabledAt),
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
        inviterAccountsTable,
        eq(inviterAccountsTable.id, organizationInvitationsTable.invitedBy),
      )
      .where(
        and(
          eq(organizationMembersTable.accountId, input.viewerId),
          eq(organizationMembersTable.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

export async function listPendingOrganizationInvitationRecordsForEmail(
  database: D1Database,
  email: string,
  accountId: AccountId,
): Promise<OrganizationInvitationRow[]> {
  const normalizedEmail = normalizeEmail(email);
  const activeMembership = getAppDatabase(database)
    .select({ accountId: organizationMembersTable.accountId })
    .from(organizationMembersTable)
    .where(
      and(
        eq(organizationMembersTable.organizationId, organizationInvitationsTable.organizationId),
        eq(organizationMembersTable.accountId, accountId),
        isNull(organizationMembersTable.disabledAt),
      ),
    );

  return selectOrganizationInvitationRecords(database)
    .where(
      and(
        eq(organizationInvitationsTable.email, normalizedEmail),
        eq(organizationInvitationsTable.status, "pending"),
        notExists(activeMembership),
      ),
    )
    .orderBy(desc(organizationInvitationsTable.id))
    .all();
}
