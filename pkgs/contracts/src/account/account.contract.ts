import type { AuthMethod, AuthSecurityLevel } from "../auth/auth.contract";
import type { AccountId } from "../id/id.contract";
import type { OrganizationSummary } from "../organization/organization.contract";

export interface AccountProfile {
  email: string;
  id: AccountId;
  imageUrl: string | null;
  name: string;
  systemAgentModel: SystemAgentModelSetting | null;
}

export interface UpdateAccountProfileInput {
  imageUrl?: string | null;
  name: string;
}

export interface SystemAgentModelSetting {
  modelId: string;
  vendor: string;
}

export interface SetSystemAgentModelInput {
  modelId: string;
  vendor: string;
}

export interface OnboardingStatus {
  completed: boolean;
  organization: OrganizationSummary | null;
}

export interface BootstrapOnboardingInput {
  name?: string;
}

export interface ViewerAuth {
  currentSecurityLevel: AuthSecurityLevel;
  methods: AuthMethod[];
}

export interface Viewer {
  account: AccountProfile | null;
  activeOrganization: OrganizationSummary | null;
  auth: ViewerAuth;
  organizations: OrganizationSummary[];
}
