import type {
  OrganizationAccessRequest,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationSummary,
} from "@mosoo/contracts/organization";

import {
  toAccountId,
  toOrganizationAccessRequestId,
  toOrganizationId,
  toOrganizationInvitationId,
} from "@/routes/typed-id";

type GraphQLOrganizationSummary = Omit<OrganizationSummary, "id"> & {
  id: string;
};

type GraphQLOrganizationInvitation = Omit<
  OrganizationInvitation,
  "accountId" | "id" | "invitedBy" | "organizationId"
> & {
  accountId: string | null;
  id: string;
  invitedBy: string;
  organizationId: string;
};

type GraphQLOrganizationAccessRequest = Omit<
  OrganizationAccessRequest,
  "id" | "organizationId" | "referrerAccountId" | "requestedByAccountId" | "reviewedBy"
> & {
  id: string;
  organizationId: string;
  referrerAccountId: string | null;
  requestedByAccountId: string;
  reviewedBy: string | null;
};

type GraphQLOrganizationMember = Omit<OrganizationMember, "accountId" | "disabledByAccountId"> & {
  accountId: string;
  disabledByAccountId: string | null;
};

export function toOrganizationSummary(
  organization: GraphQLOrganizationSummary,
): OrganizationSummary {
  return {
    ...organization,
    id: toOrganizationId(organization.id),
  };
}

export function toOrganizationInvitation(
  invitation: GraphQLOrganizationInvitation,
): OrganizationInvitation {
  return {
    ...invitation,
    accountId: invitation.accountId === null ? null : toAccountId(invitation.accountId),
    id: toOrganizationInvitationId(invitation.id),
    invitedBy: toAccountId(invitation.invitedBy),
    organizationId: toOrganizationId(invitation.organizationId),
  };
}

export function toOrganizationAccessRequest(
  request: GraphQLOrganizationAccessRequest,
): OrganizationAccessRequest {
  return {
    ...request,
    id: toOrganizationAccessRequestId(request.id),
    organizationId: toOrganizationId(request.organizationId),
    referrerAccountId:
      request.referrerAccountId === null ? null : toAccountId(request.referrerAccountId),
    requestedByAccountId: toAccountId(request.requestedByAccountId),
    reviewedBy: request.reviewedBy === null ? null : toAccountId(request.reviewedBy),
  };
}

export function toOrganizationMember(member: GraphQLOrganizationMember): OrganizationMember {
  return {
    ...member,
    accountId: toAccountId(member.accountId),
    disabledByAccountId:
      member.disabledByAccountId === null ? null : toAccountId(member.disabledByAccountId),
  };
}
