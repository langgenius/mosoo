import type { OrganizationId, OrganizationInvitationId } from "@mosoo/contracts/id";
import type { OrganizationInvitation } from "@mosoo/contracts/organization";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { toOrganizationInvitation, toOrganizationSummary } from "./organization-mappers";
import type { Organization } from "./organization-types";

const ORGANIZATION_INVITATIONS_QUERY = graphql(/* GraphQL */ `
  query OrganizationInvitations($organizationId: ULID!) {
    organizationInvitationList(organizationId: $organizationId) {
      createdAt
      email
      expiresAt
      id
      invitedBy
      invitedByName
      organizationId
      organizationName
      status
      updatedAt
      accountId
    }
  }
`);

const PENDING_ORGANIZATION_INVITATIONS_QUERY = graphql(/* GraphQL */ `
  query PendingOrganizationInvitations {
    pendingOrganizationInvitationList {
      createdAt
      email
      expiresAt
      id
      invitedBy
      invitedByName
      organizationId
      organizationName
      status
      updatedAt
      accountId
    }
  }
`);

const INVITE_MEMBER_MUTATION = graphql(/* GraphQL */ `
  mutation InviteOrganizationMember($input: InviteOrganizationMemberInput!) {
    inviteOrganizationMember(input: $input) {
      createdAt
      email
      expiresAt
      id
      invitedBy
      invitedByName
      organizationId
      organizationName
      status
      updatedAt
      accountId
    }
  }
`);

const ACCEPT_INVITATION_MUTATION = graphql(/* GraphQL */ `
  mutation AcceptOrganizationInvitation($input: AcceptOrganizationInvitationInput!) {
    acceptOrganizationInvitation(input: $input) {
      avatarUrl
      createdAt
      id
      joinPolicy
      name
      primaryDomain
      slug
      viewerRole
    }
  }
`);

const CANCEL_INVITATION_MUTATION = graphql(/* GraphQL */ `
  mutation CancelOrganizationInvitation($input: CancelOrganizationInvitationInput!) {
    cancelOrganizationInvitation(input: $input) {
      createdAt
      email
      expiresAt
      id
      invitedBy
      invitedByName
      organizationId
      organizationName
      status
      updatedAt
      accountId
    }
  }
`);

export async function inviteMember(
  organizationId: OrganizationId,
  email: string,
): Promise<OrganizationInvitation> {
  const payload = await requestGraphQL(INVITE_MEMBER_MUTATION, {
    input: {
      email,
      organizationId,
    },
  });

  return toOrganizationInvitation(payload.inviteOrganizationMember);
}

export async function pendingOrganizationInvitations(): Promise<OrganizationInvitation[]> {
  const payload = await requestGraphQL(PENDING_ORGANIZATION_INVITATIONS_QUERY);

  return payload.pendingOrganizationInvitationList.map(toOrganizationInvitation);
}

export async function organizationInvitations(
  organizationId: OrganizationId,
): Promise<OrganizationInvitation[]> {
  const payload = await requestGraphQL(ORGANIZATION_INVITATIONS_QUERY, {
    organizationId,
  });

  return payload.organizationInvitationList.map(toOrganizationInvitation);
}

export async function acceptOrganizationInvitation(
  invitationId: OrganizationInvitationId,
): Promise<Organization> {
  const payload = await requestGraphQL(ACCEPT_INVITATION_MUTATION, {
    input: {
      invitationId,
    },
  });

  return toOrganizationSummary(payload.acceptOrganizationInvitation);
}

export async function cancelOrganizationInvitation(
  invitationId: OrganizationInvitationId,
): Promise<OrganizationInvitation> {
  const payload = await requestGraphQL(CANCEL_INVITATION_MUTATION, {
    input: {
      invitationId,
    },
  });

  return toOrganizationInvitation(payload.cancelOrganizationInvitation);
}
