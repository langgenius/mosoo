import {
  organizationAccessRequestsTable,
  organizationMembersTable,
  organizationsTable,
} from "@mosoo/db";
import type { AccountId, OrganizationAccessRequestId, OrganizationId } from "@mosoo/id";
import { and, desc, eq, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { organizationKindValue } from "../domain/organization-kind.policy";
import {
  organizationAccessRequestRecordColumns,
  referrerAccountsTable,
  requesterAccountsTable,
  reviewerAccountsTable,
  selectOrganizationAccessRequestRecords,
} from "./organization-access-record-query";
import type {
  OrganizationAccessRequestListAdmissionRow,
  OrganizationAccessRequestReviewAdmissionRow,
  OrganizationAccessRequestRow,
} from "./organization-access-record.types";

export async function getOrganizationAccessRequestReviewAdmission(
  database: D1Database,
  input: {
    requestId: OrganizationAccessRequestId;
    viewerId: AccountId;
  },
): Promise<OrganizationAccessRequestReviewAdmissionRow | null> {
  return (
    (await getAppDatabase(database)
      .select({
        ...organizationAccessRequestRecordColumns(),
        organization_kind: organizationKindValue(),
        viewer_disabled_at: organizationMembersTable.disabledAt,
        viewer_role: organizationMembersTable.role,
      })
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
      )
      .leftJoin(
        organizationMembersTable,
        and(
          eq(
            organizationMembersTable.organizationId,
            organizationAccessRequestsTable.organizationId,
          ),
          eq(organizationMembersTable.accountId, input.viewerId),
        ),
      )
      .where(eq(organizationAccessRequestsTable.id, input.requestId))
      .limit(1)
      .get()) ?? null
  );
}

export async function getPendingOrganizationAccessRequestRecordByUser(
  database: D1Database,
  organizationId: OrganizationId,
  userId: AccountId,
): Promise<OrganizationAccessRequestRow | null> {
  return (
    (await selectOrganizationAccessRequestRecords(database)
      .where(
        and(
          eq(organizationAccessRequestsTable.organizationId, organizationId),
          eq(organizationAccessRequestsTable.requestedByAccountId, userId),
          eq(organizationAccessRequestsTable.status, "pending"),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

export async function listPendingOrganizationAccessRequestRecordsForViewer(
  database: D1Database,
  input: {
    organizationId: OrganizationId;
    viewerId: AccountId;
  },
): Promise<OrganizationAccessRequestListAdmissionRow[]> {
  return getAppDatabase(database)
    .select({
      created_at: organizationAccessRequestsTable.createdAt,
      id: organizationAccessRequestsTable.id,
      organization_id: organizationsTable.id,
      organization_name: organizationsTable.name,
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
      viewer_disabled_at: organizationMembersTable.disabledAt,
      viewer_role: organizationMembersTable.role,
    })
    .from(organizationMembersTable)
    .innerJoin(
      organizationsTable,
      eq(organizationsTable.id, organizationMembersTable.organizationId),
    )
    .leftJoin(
      organizationAccessRequestsTable,
      and(
        eq(organizationAccessRequestsTable.organizationId, organizationsTable.id),
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
    .where(
      and(
        eq(organizationMembersTable.accountId, input.viewerId),
        eq(organizationMembersTable.organizationId, input.organizationId),
      ),
    )
    .orderBy(desc(organizationAccessRequestsTable.id))
    .all();
}
