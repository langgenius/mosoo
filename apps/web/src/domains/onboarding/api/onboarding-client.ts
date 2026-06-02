import type { OrganizationId } from "@mosoo/contracts/id";
import type { OrganizationSummary } from "@mosoo/contracts/organization";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toOrganizationId } from "@/routes/typed-id";

import { toOrganizationSummary } from "../../organization/api/organization-mappers";

export interface DiscoverResult {
  domain: string;
  orgs: {
    creator: string;
    id: OrganizationId;
    joinPolicy: string;
    memberCount: number;
    name: string;
  }[];
  isPublicEmail: boolean;
}

const ONBOARDING_DISCOVERY_QUERY = graphql(/* GraphQL */ `
  query OnboardingDiscovery {
    onboardingDiscovery {
      domain
      isPublicEmail
      orgs {
        creator
        id
        joinPolicy
        memberCount
        name
      }
    }
  }
`);

const ONBOARDING_BOOTSTRAP_MUTATION = graphql(/* GraphQL */ `
  mutation OnboardingBootstrap($input: BootstrapOnboardingInput!) {
    onboardingBootstrap(input: $input) {
      completed
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

export async function onboardingDiscover(): Promise<DiscoverResult> {
  const payload = await requestGraphQL(ONBOARDING_DISCOVERY_QUERY);

  return {
    domain: payload.onboardingDiscovery.domain,
    isPublicEmail: payload.onboardingDiscovery.isPublicEmail,
    orgs: payload.onboardingDiscovery.orgs.map((organization) => ({
      creator: organization.creator,
      id: toOrganizationId(organization.id),
      joinPolicy: organization.joinPolicy,
      memberCount: organization.memberCount,
      name: organization.name,
    })),
  };
}

export async function onboardingBootstrap(
  action: "join" | "create",
  input?: { kind?: OrganizationSummary["kind"]; name?: string; organizationId?: OrganizationId },
): Promise<{ organization: OrganizationSummary }> {
  const payload = await requestGraphQL(ONBOARDING_BOOTSTRAP_MUTATION, {
    input: {
      action,
      ...input,
    },
  });

  if (!payload.onboardingBootstrap.organization) {
    throw new Error("Organization provisioning failed.");
  }

  return {
    organization: toOrganizationSummary(payload.onboardingBootstrap.organization),
  };
}
