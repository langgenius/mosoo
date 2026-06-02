import type {
  OrganizationAccessRequest,
  OrganizationInvitation,
} from "@mosoo/contracts/organization";
import type { AccountId, OrganizationAccessRequestId, OrganizationId } from "@mosoo/id";

import { isTruthy } from "../../../shared/truthiness";
import { toIsoString } from "../../../time";
import type {
  OrganizationAccessRequestListAdmissionRow,
  OrganizationAccessRequestRow,
  OrganizationInvitationRow,
} from "./organization-access-record-store";
export function toOrganizationInvitation(row: OrganizationInvitationRow): OrganizationInvitation {
  return {
    accountId: row.account_id,
    createdAt: toIsoString(row.created_at),
    email: row.email,
    expiresAt: isTruthy(row.expires_at) ? toIsoString(row.expires_at) : null,
    id: row.id,
    invitedBy: row.invited_by,
    invitedByName: row.invited_by_name,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    status: row.status,
    updatedAt: toIsoString(row.updated_at),
  };
}

export function toOrganizationAccessRequest(
  row: OrganizationAccessRequestRow,
): OrganizationAccessRequest {
  return {
    createdAt: toIsoString(row.created_at),
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    referrerAccountId: row.referrer_account_id,
    referrerName: row.referrer_name,
    requestedByAccountId: row.requested_by_account_id,
    requesterEmail: row.requester_email,
    requesterName: row.requester_name,
    reviewedAt: isTruthy(row.reviewed_at) ? toIsoString(row.reviewed_at) : null,
    reviewedBy: row.reviewed_by,
    reviewedByName: row.reviewed_by_name,
    status: row.status,
    updatedAt: toIsoString(row.updated_at),
  };
}

export function toPendingOrganizationAccessRequest(input: {
  createdAtMs: number;
  id: OrganizationAccessRequestId;
  organizationId: OrganizationId;
  organizationName: string;
  referrerAccountId: AccountId | null;
  referrerName: string | null;
  requestedByAccountId: AccountId;
  requesterEmail: string;
  requesterName: string;
  updatedAtMs?: number;
}): OrganizationAccessRequest {
  const row = {
    created_at: input.createdAtMs,
    id: input.id,
    organization_id: input.organizationId,
    organization_name: input.organizationName,
    referrer_account_id: input.referrerAccountId,
    referrer_name: input.referrerName,
    requested_by_account_id: input.requestedByAccountId,
    requester_email: input.requesterEmail,
    requester_name: input.requesterName,
    reviewed_at: null,
    reviewed_by: null,
    reviewed_by_name: null,
    status: "pending",
    updated_at: input.updatedAtMs ?? input.createdAtMs,
  } satisfies OrganizationAccessRequestRow;

  return toOrganizationAccessRequest(row);
}

export function toListedOrganizationAccessRequest(
  row: OrganizationAccessRequestListAdmissionRow,
): OrganizationAccessRequest | null {
  if (row.id === null) {
    return null;
  }

  if (
    row.created_at === null ||
    row.requested_by_account_id === null ||
    row.requester_email === null ||
    row.requester_name === null ||
    row.status === null ||
    row.updated_at === null
  ) {
    throw new Error("Access request list row is incomplete.");
  }

  return toOrganizationAccessRequest({
    created_at: row.created_at,
    id: row.id,
    organization_id: row.organization_id,
    organization_name: row.organization_name,
    referrer_account_id: row.referrer_account_id,
    referrer_name: row.referrer_name,
    requested_by_account_id: row.requested_by_account_id,
    requester_email: row.requester_email,
    requester_name: row.requester_name,
    reviewed_at: row.reviewed_at,
    reviewed_by: row.reviewed_by,
    reviewed_by_name: row.reviewed_by_name,
    status: row.status,
    updated_at: row.updated_at,
  });
}

export function isExpiredInvitation(invitation: OrganizationInvitation): boolean {
  if (!isTruthy(invitation.expiresAt)) {
    return false;
  }

  return new Date(invitation.expiresAt).getTime() < Date.now();
}
