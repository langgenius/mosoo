import type { OrganizationSummary } from "@mosoo/contracts/organization";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";

import { toOrganizationSummary } from "../../organization/api/organization-mappers";

const ONBOARDING_BOOTSTRAP_MUTATION = graphql(/* GraphQL */ `
  mutation OnboardingBootstrap($input: BootstrapOnboardingInput!) {
    onboardingBootstrap(input: $input) {
      completed
      organization {
        createdAt
        id
        name
      }
    }
  }
`);

export async function onboardingBootstrap(): Promise<{ organization: OrganizationSummary }> {
  const payload = await requestGraphQL(ONBOARDING_BOOTSTRAP_MUTATION, { input: {} });

  if (!payload.onboardingBootstrap.organization) {
    throw new Error("Project provisioning failed.");
  }

  return {
    organization: toOrganizationSummary(payload.onboardingBootstrap.organization),
  };
}
