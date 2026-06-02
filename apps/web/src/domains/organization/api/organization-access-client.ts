import type { OrganizationAccessRequestId, OrganizationId } from "@mosoo/contracts/id";
import type {
  OrganizationAccessRequest,
  OrganizationJoinPolicy,
  OrganizationJoinTarget,
} from "@mosoo/contracts/organization";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toOrganizationId } from "@/routes/typed-id";

import {
  toOrganizationAccessRequest,
  toOrganizationInvitation,
  toOrganizationSummary,
} from "./organization-mappers";

const ORGANIZATION_ACCESS_REQUESTS_QUERY = graphql(/* GraphQL */ `
  query OrganizationAccessRequests($organizationId: ULID!) {
    organizationAccessRequestList(organizationId: $organizationId) {
      createdAt
      id
      organizationId
      organizationName
      referrerAccountId
      referrerName
      requestedByAccountId
      requesterEmail
      requesterName
      reviewedAt
      reviewedBy
      reviewedByName
      status
      updatedAt
    }
  }
`);

const ORGANIZATION_JOIN_TARGET_QUERY = graphql(/* GraphQL */ `
  query OrganizationJoinTarget($organizationId: ULID!) {
    organizationJoinTarget(organizationId: $organizationId) {
      organizationId
      organizationName
      viewerIsAuthenticated
      viewerIsMember
      pendingInvitation {
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
      pendingRequest {
        createdAt
        id
        organizationId
        organizationName
        referrerAccountId
        referrerName
        requestedByAccountId
        requesterEmail
        requesterName
        reviewedAt
        reviewedBy
        reviewedByName
        status
        updatedAt
      }
      organization {
        avatarUrl
        createdAt
        id
        joinPolicy
        kind
        name
        primaryDomain
        slug
        viewerRole
      }
    }
  }
`);

const REQUEST_ORGANIZATION_ACCESS_MUTATION = graphql(/* GraphQL */ `
  mutation RequestOrganizationAccess($input: RequestOrganizationAccessInput!) {
    requestOrganizationAccess(input: $input) {
      createdAt
      id
      organizationId
      organizationName
      referrerAccountId
      referrerName
      requestedByAccountId
      requesterEmail
      requesterName
      reviewedAt
      reviewedBy
      reviewedByName
      status
      updatedAt
    }
  }
`);

const REQUEST_ORGANIZATION_INVITATION_MUTATION = graphql(/* GraphQL */ `
  mutation RequestOrganizationInvitation($input: RequestOrganizationInvitationInput!) {
    requestOrganizationInvitation(input: $input) {
      createdAt
      id
      organizationId
      organizationName
      referrerAccountId
      referrerName
      requestedByAccountId
      requesterEmail
      requesterName
      reviewedAt
      reviewedBy
      reviewedByName
      status
      updatedAt
    }
  }
`);

const REVIEW_ORGANIZATION_ACCESS_REQUEST_MUTATION = graphql(/* GraphQL */ `
  mutation ReviewOrganizationAccessRequest($input: ReviewOrganizationAccessRequestInput!) {
    reviewOrganizationAccessRequest(input: $input) {
      createdAt
      id
      organizationId
      organizationName
      referrerAccountId
      referrerName
      requestedByAccountId
      requesterEmail
      requesterName
      reviewedAt
      reviewedBy
      reviewedByName
      status
      updatedAt
    }
  }
`);

const UPDATE_JOIN_POLICY_MUTATION = graphql(/* GraphQL */ `
  mutation UpdateOrganizationJoinPolicy($input: UpdateOrganizationJoinPolicyInput!) {
    updateOrganizationJoinPolicy(input: $input) {
      joinPolicy
    }
  }
`);

export async function organizationAccessRequests(
  organizationId: OrganizationId,
): Promise<OrganizationAccessRequest[]> {
  const payload = await requestGraphQL(ORGANIZATION_ACCESS_REQUESTS_QUERY, {
    organizationId,
  });

  return payload.organizationAccessRequestList.map(toOrganizationAccessRequest);
}

export async function requestOrganizationAccess(
  organizationId: OrganizationId,
): Promise<OrganizationAccessRequest> {
  const payload = await requestGraphQL(REQUEST_ORGANIZATION_ACCESS_MUTATION, {
    input: {
      organizationId,
    },
  });

  return toOrganizationAccessRequest(payload.requestOrganizationAccess);
}

export async function requestOrganizationInvitation(
  organizationId: OrganizationId,
  email: string,
): Promise<OrganizationAccessRequest> {
  const payload = await requestGraphQL(REQUEST_ORGANIZATION_INVITATION_MUTATION, {
    input: {
      email,
      organizationId,
    },
  });

  return toOrganizationAccessRequest(payload.requestOrganizationInvitation);
}

export async function reviewOrganizationAccessRequest(
  requestId: OrganizationAccessRequestId,
  decision: "approve" | "reject",
): Promise<OrganizationAccessRequest> {
  const payload = await requestGraphQL(REVIEW_ORGANIZATION_ACCESS_REQUEST_MUTATION, {
    input: {
      decision,
      requestId,
    },
  });

  return toOrganizationAccessRequest(payload.reviewOrganizationAccessRequest);
}

export async function organizationJoinTarget(
  organizationId: OrganizationId,
): Promise<OrganizationJoinTarget> {
  const payload = await requestGraphQL(ORGANIZATION_JOIN_TARGET_QUERY, {
    organizationId,
  });

  return {
    organization: toOrganizationSummary(payload.organizationJoinTarget.organization),
    organizationId: toOrganizationId(payload.organizationJoinTarget.organizationId),
    organizationName: payload.organizationJoinTarget.organizationName,
    pendingInvitation:
      payload.organizationJoinTarget.pendingInvitation === null
        ? null
        : toOrganizationInvitation(payload.organizationJoinTarget.pendingInvitation),
    pendingRequest:
      payload.organizationJoinTarget.pendingRequest === null
        ? null
        : toOrganizationAccessRequest(payload.organizationJoinTarget.pendingRequest),
    viewerIsAuthenticated: payload.organizationJoinTarget.viewerIsAuthenticated,
    viewerIsMember: payload.organizationJoinTarget.viewerIsMember,
  };
}

export async function updateJoinPolicy(
  organizationId: OrganizationId,
  joinPolicy: OrganizationJoinPolicy,
): Promise<{ joinPolicy: OrganizationJoinPolicy; ok: true }> {
  await requestGraphQL(UPDATE_JOIN_POLICY_MUTATION, {
    input: {
      joinPolicy,
      organizationId,
    },
  });

  return {
    joinPolicy,
    ok: true as const,
  };
}
