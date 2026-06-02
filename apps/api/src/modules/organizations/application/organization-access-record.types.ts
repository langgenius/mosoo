import type {
  OrganizationAccessRequest,
  OrganizationJoinPolicy,
  OrganizationKind,
  OrganizationInvitation,
  OrganizationMemberRole,
} from "@mosoo/contracts/organization";
import type {
  AccountId,
  OrganizationAccessRequestId,
  OrganizationId,
  OrganizationInvitationId,
} from "@mosoo/id";

import type { OrganizationSummaryRow } from "../domain/organization-access.policy";

export interface OrganizationInvitationRow {
  created_at: number;
  email: string;
  expires_at: number | null;
  id: OrganizationInvitationId;
  invited_by: AccountId;
  invited_by_name: string | null;
  organization_id: OrganizationId;
  organization_name: string;
  status: OrganizationInvitation["status"];
  updated_at: number;
  account_id: AccountId | null;
}

export interface OrganizationInvitationAcceptanceRow extends OrganizationInvitationRow {
  organization_avatar_url: string | null;
  organization_created_at: number;
  organization_join_policy: OrganizationJoinPolicy;
  organization_kind: OrganizationKind;
  organization_primary_domain: string | null;
  organization_slug: string;
}

export interface OrganizationInvitationCancellationAdmissionRow extends OrganizationInvitationRow {
  viewer_disabled_at: number | null;
  viewer_role: OrganizationMemberRole | null;
}

export interface OrganizationInvitationListAdmissionRow {
  account_id: AccountId | null;
  created_at: number | null;
  email: string | null;
  expires_at: number | null;
  id: OrganizationInvitationId | null;
  invited_by: AccountId | null;
  invited_by_name: string | null;
  organization_id: OrganizationId;
  organization_name: string;
  status: OrganizationInvitation["status"] | null;
  updated_at: number | null;
  viewer_disabled_at: number | null;
  viewer_role: OrganizationMemberRole;
}

export interface OrganizationInviteMemberAdmissionRow extends OrganizationInvitationListAdmissionRow {
  existing_member_account_id: AccountId | null;
  kind: OrganizationKind;
}

export interface OrganizationAccessRequestRow {
  created_at: number;
  id: OrganizationAccessRequestId;
  organization_id: OrganizationId;
  organization_name: string;
  referrer_account_id: AccountId | null;
  referrer_name: string | null;
  requested_by_account_id: AccountId;
  requester_email: string;
  requester_name: string;
  reviewed_at: number | null;
  reviewed_by: AccountId | null;
  reviewed_by_name: string | null;
  status: OrganizationAccessRequest["status"];
  updated_at: number;
}

export interface OrganizationAccessRequestReviewAdmissionRow extends OrganizationAccessRequestRow {
  organization_kind: OrganizationKind;
  viewer_disabled_at: number | null;
  viewer_role: OrganizationMemberRole | null;
}

export interface OrganizationAccessRequestListAdmissionRow {
  created_at: number | null;
  id: OrganizationAccessRequestId | null;
  organization_id: OrganizationId;
  organization_name: string;
  referrer_account_id: AccountId | null;
  referrer_name: string | null;
  requested_by_account_id: AccountId | null;
  requester_email: string | null;
  requester_name: string | null;
  reviewed_at: number | null;
  reviewed_by: AccountId | null;
  reviewed_by_name: string | null;
  status: OrganizationAccessRequest["status"] | null;
  updated_at: number | null;
  viewer_disabled_at: number | null;
  viewer_role: OrganizationMemberRole;
}

export interface OrganizationJoinTargetSnapshot {
  organization: OrganizationSummaryRow;
  pendingInvitation: OrganizationInvitationRow | null;
  pendingRequest: OrganizationAccessRequestRow | null;
}

export interface OrganizationAccessSubmissionAdmissionRow {
  active_domain_id: string | null;
  active_membership_account_id: AccountId | null;
  join_policy: OrganizationJoinPolicy;
  kind: OrganizationKind;
  organization_id: OrganizationId;
  organization_name: string;
  primary_domain: string | null;
  pending_invitation_id: OrganizationInvitationId | null;
  pending_request_created_at: number | null;
  pending_request_id: OrganizationAccessRequestId | null;
  pending_request_referrer_account_id: AccountId | null;
  pending_request_referrer_name: string | null;
  pending_request_requester_email: string | null;
  pending_request_updated_at: number | null;
}

export interface OrganizationInvitationRequestAdmissionRow {
  invitee_active_membership_account_id: AccountId | null;
  invitee_id: AccountId | null;
  invitee_name: string | null;
  kind: OrganizationKind;
  organization_id: OrganizationId;
  organization_name: string;
  pending_invitation_id: OrganizationInvitationId | null;
  pending_request_created_at: number | null;
  pending_request_id: OrganizationAccessRequestId | null;
  pending_request_referrer_account_id: AccountId | null;
  pending_request_referrer_name: string | null;
  pending_request_requester_email: string | null;
  pending_request_updated_at: number | null;
  viewer_disabled_at: number | null;
  viewer_role: OrganizationMemberRole;
}
