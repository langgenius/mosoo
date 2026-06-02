import type {
  AccountId,
  AgentId,
  OrganizationId,
  OrganizationServiceTokenId,
  PersonalAccessTokenId,
} from "../id/id.contract";

export type AuthMethod = "email_otp" | "google_oauth";

export type AuthSecurityLevel = "basic" | "verified_email" | "strong";

export interface PersonalAccessTokenSummary {
  createdAt: string;
  id: PersonalAccessTokenId;
  label: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatePersonalAccessTokenRequest {
  label: string;
}

export interface CreatePersonalAccessTokenResponse {
  token: PersonalAccessTokenSummary;
  value: string;
}

export interface PersonalAccessTokenListResponse {
  tokens: PersonalAccessTokenSummary[];
}

export interface OrganizationServiceTokenSummary {
  allowAttribution: boolean;
  allowedAgentIds: AgentId[];
  createdAt: string;
  createdByAccountId: AccountId;
  id: OrganizationServiceTokenId;
  label: string;
  lastUsedAt: string | null;
  organizationId: OrganizationId;
  revokedAt: string | null;
}

export interface CreateOrganizationServiceTokenRequest {
  allowAttribution: boolean;
  allowedAgentIds: AgentId[];
  label: string;
  organizationId: OrganizationId;
}

export interface CreateOrganizationServiceTokenResponse {
  token: OrganizationServiceTokenSummary;
  value: string;
}

export interface OrganizationServiceTokenListResponse {
  tokens: OrganizationServiceTokenSummary[];
}
