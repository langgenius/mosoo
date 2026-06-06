import type {
  AccountId,
  OrganizationAccessRequestId,
  OrganizationId,
  OrganizationInvitationId,
} from "../id/id.contract";

export type OrganizationMemberRole = "owner" | "admin" | "member";
export type OrganizationMemberStatus = "active" | "disabled";
export type OrganizationJoinPolicy = "auto" | "invite_only";
export type OrganizationInvitationStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled"
  | "expired";
export type OrganizationAccessRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface OrganizationSummary {
  avatarUrl: string | null;
  createdAt: string;
  id: OrganizationId;
  joinPolicy: OrganizationJoinPolicy;
  name: string;
  primaryDomain: string | null;
  slug: string;
  viewerRole: OrganizationMemberRole | null;
}

export interface OrganizationCreationSlotStatus {
  occupied: boolean;
  organizationId: OrganizationId | null;
}

export interface OrganizationMember {
  accountId: AccountId;
  disabledAt: string | null;
  disabledByAccountId: AccountId | null;
  email: string;
  imageUrl: string | null;
  joinedAt: string;
  name: string;
  role: OrganizationMemberRole;
  status: OrganizationMemberStatus;
}

export interface OrganizationInvitation {
  accountId: AccountId | null;
  createdAt: string;
  email: string;
  expiresAt: string | null;
  id: OrganizationInvitationId;
  invitedBy: AccountId;
  invitedByName: string | null;
  organizationId: OrganizationId;
  organizationName: string;
  status: OrganizationInvitationStatus;
  updatedAt: string;
}

export interface OrganizationAccessRequest {
  createdAt: string;
  id: OrganizationAccessRequestId;
  organizationId: OrganizationId;
  organizationName: string;
  referrerAccountId: AccountId | null;
  referrerName: string | null;
  requestedByAccountId: AccountId;
  requesterEmail: string;
  requesterName: string;
  reviewedAt: string | null;
  reviewedBy: AccountId | null;
  reviewedByName: string | null;
  status: OrganizationAccessRequestStatus;
  updatedAt: string;
}

export interface OrganizationJoinTarget {
  organizationId: OrganizationId;
  organizationName: string;
  pendingInvitation: OrganizationInvitation | null;
  pendingRequest: OrganizationAccessRequest | null;
  viewerIsAuthenticated: boolean;
  viewerIsMember: boolean;
  organization: OrganizationSummary;
}

export interface UpdateOrganizationMemberRoleInput {
  accountId: AccountId;
  role: OrganizationMemberRole;
  organizationId: OrganizationId;
}

export interface RemoveOrganizationMemberInput {
  accountId: AccountId;
  organizationId: OrganizationId;
}

export interface SetOrganizationMemberStatusInput {
  accountId: AccountId;
  organizationId: OrganizationId;
  status: OrganizationMemberStatus;
}

export interface InviteOrganizationMemberInput {
  email: string;
  organizationId: OrganizationId;
}

export interface RequestOrganizationInvitationInput {
  email: string;
  organizationId: OrganizationId;
}

export interface AcceptOrganizationInvitationInput {
  invitationId: OrganizationInvitationId;
}

export interface CancelOrganizationInvitationInput {
  invitationId: OrganizationInvitationId;
}

export interface CreateOrganizationInput {
  name?: string;
}

export interface SetActiveOrganizationInput {
  organizationId: OrganizationId;
}

export interface RequestOrganizationAccessInput {
  organizationId: OrganizationId;
}

export interface ReviewOrganizationAccessRequestInput {
  decision: "approve" | "reject";
  requestId: OrganizationAccessRequestId;
}

export interface UpdateOrganizationJoinPolicyInput {
  joinPolicy: OrganizationJoinPolicy;
  organizationId: OrganizationId;
}

export interface UpdateOrganizationPrimaryDomainInput {
  domain: string | null;
  organizationId: OrganizationId;
}

export interface UpdateOrganizationProfileInput {
  avatarUrl?: string | null;
  name?: string;
  organizationId: OrganizationId;
}
