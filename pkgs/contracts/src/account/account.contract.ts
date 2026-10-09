import type { AccountId } from "@mosoo/id";

import type { OrganizationSummary } from "../organization/organization.contract";

export interface AccountProfile {
  email: string;
  id: AccountId;
  imageUrl: string | null;
  name: string;
}

export interface UpdateAccountProfileInput {
  imageUrl?: string | null;
  name: string;
}

export interface OnboardingStatus {
  completed: boolean;
  organization: OrganizationSummary | null;
}

export interface BootstrapOnboardingInput {
  name?: string;
}

export interface Viewer {
  account: AccountProfile | null;
  activeOrganization: OrganizationSummary | null;
  organizations: OrganizationSummary[];
}
