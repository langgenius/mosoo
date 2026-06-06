import type { AuthMethod, AuthSecurityLevel } from "../auth/auth.contract";
import type { AccountId, OrganizationId } from "../id/id.contract";
import type {
  OrganizationCreationSlotStatus,
  OrganizationMemberRole,
  OrganizationSummary,
} from "../organization/organization.contract";

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

export interface OnboardingDiscoveryOrganization {
  creator: string;
  id: OrganizationId;
  joinPolicy: "auto" | "invite_only";
  memberCount: number;
  name: string;
}

export interface OnboardingDiscovery {
  domain: string;
  isPublicEmail: boolean;
  orgs: OnboardingDiscoveryOrganization[];
}

export interface OnboardingStatus {
  completed: boolean;
  organization: OrganizationSummary | null;
}

export interface BootstrapOnboardingInput {
  action: "create" | "join";
  name?: string;
  organizationId?: OrganizationId;
}

export interface ViewerAuth {
  currentSecurityLevel: AuthSecurityLevel;
  methods: AuthMethod[];
}

export interface ViewerOrganizationMembership {
  joinedAt: string;
  organization: OrganizationSummary;
  role: OrganizationMemberRole;
}

export interface Viewer {
  account: AccountProfile | null;
  activeOrganization: OrganizationSummary | null;
  auth: ViewerAuth;
  memberships: ViewerOrganizationMembership[];
  organizationCreationSlot: OrganizationCreationSlotStatus;
}
