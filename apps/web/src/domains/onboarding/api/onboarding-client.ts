import type { OrganizationSummary } from "@mosoo/contracts/organization";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { toOrganizationSummary } from "../../organization/api/organization-mappers";

const ONBOARDING_BOOTSTRAP_MUTATION = graphql(/* GraphQL */ `
  mutation OnboardingBootstrap($input: BootstrapOnboardingInput!) {
    onboardingBootstrap(input: $input) {
      completed
      organization {
        avatarUrl
        createdAt
        id
        name
        slug
      }
    }
  }
`);

export async function onboardingBootstrap(input?: {
  name?: string;
}): Promise<{ organization: OrganizationSummary }> {
  const payload = await requestGraphQL(ONBOARDING_BOOTSTRAP_MUTATION, {
    input: input ?? {},
  });

  if (!payload.onboardingBootstrap.organization) {
    throw new Error("Organization provisioning failed.");
  }

  return {
    organization: toOrganizationSummary(payload.onboardingBootstrap.organization),
  };
}
