import type { OrganizationId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { toOrganizationSummary } from "./organization-mappers";
import type { Organization } from "./organization-types";

const CREATE_ORGANIZATION_MUTATION = graphql(/* GraphQL */ `
  mutation CreateOrganization($input: CreateOrganizationInput!) {
    createOrganization(input: $input) {
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

const SET_ACTIVE_ORGANIZATION_MUTATION = graphql(/* GraphQL */ `
  mutation SetActiveOrganization($input: SetActiveOrganizationInput!) {
    setActiveOrganization(input: $input) {
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

const UPDATE_ORGANIZATION_PRIMARY_DOMAIN_MUTATION = graphql(/* GraphQL */ `
  mutation UpdateOrganizationPrimaryDomain($input: UpdateOrganizationPrimaryDomainInput!) {
    updateOrganizationPrimaryDomain(input: $input) {
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

const UPDATE_ORGANIZATION_PROFILE_MUTATION = graphql(/* GraphQL */ `
  mutation UpdateOrganizationProfile($input: UpdateOrganizationProfileInput!) {
    updateOrganizationProfile(input: $input) {
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

export async function createOrganization(input: { name?: string }): Promise<Organization> {
  const payload = await requestGraphQL(CREATE_ORGANIZATION_MUTATION, {
    input,
  });

  return toOrganizationSummary(payload.createOrganization);
}

export async function setActiveOrganization(organizationId: OrganizationId): Promise<Organization> {
  const payload = await requestGraphQL(SET_ACTIVE_ORGANIZATION_MUTATION, {
    input: {
      organizationId,
    },
  });

  return toOrganizationSummary(payload.setActiveOrganization);
}

export async function updateOrganizationPrimaryDomain(
  organizationId: OrganizationId,
  domain: string | null,
): Promise<Organization> {
  const payload = await requestGraphQL(UPDATE_ORGANIZATION_PRIMARY_DOMAIN_MUTATION, {
    input: {
      domain,
      organizationId,
    },
  });

  return toOrganizationSummary(payload.updateOrganizationPrimaryDomain);
}

export async function updateOrganizationProfile(input: {
  avatarUrl?: string | null;
  name?: string;
  organizationId: OrganizationId;
}): Promise<Organization> {
  const payload = await requestGraphQL(UPDATE_ORGANIZATION_PROFILE_MUTATION, {
    input,
  });

  return toOrganizationSummary(payload.updateOrganizationProfile);
}
