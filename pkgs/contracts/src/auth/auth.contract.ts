import type { PersonalAccessTokenId } from "../id/id.contract";

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
