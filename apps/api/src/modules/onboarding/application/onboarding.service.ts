import type { BootstrapOnboardingInput, OnboardingStatus } from "@mosoo/contracts/account";

import {
  captureServerProductEvent,
  SERVER_PRODUCT_ANALYTICS_EVENTS,
} from "../../../platform/analytics/product-analytics";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { provisionOrganizationWithOwner } from "../../organizations/application/organization-provisioning.service";
import { listViewerOrganizations } from "../../users/application/account-organization-context.service";
import { deriveOrgName } from "../../users/domain/user-account.policy";

export async function bootstrapOnboarding(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: BootstrapOnboardingInput,
): Promise<OnboardingStatus> {
  const [existingOrganization] = await listViewerOrganizations(bindings.DB, viewer.id);

  if (existingOrganization) {
    return { completed: true, organization: existingOrganization };
  }

  const organization = await provisionOrganizationWithOwner(
    bindings.DB,
    viewer,
    input.name?.trim() || deriveOrgName(viewer.email, viewer.name),
  );

  await captureServerProductEvent(bindings, {
    distinctId: viewer.id,
    event: SERVER_PRODUCT_ANALYTICS_EVENTS.onboardingCompleted,
    properties: { organization_id: organization.id },
  });

  return {
    completed: true,
    organization,
  };
}
