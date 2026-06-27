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

export type CliOAuthDeviceStatus = "pending" | "authorized" | "consumed" | "denied" | "expired";

export interface CliOAuthDeviceStartRequest {
  hostname?: string;
  provider?: string;
}

export interface CliOAuthDeviceStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
}

export interface CliOAuthDeviceTokenRequest {
  device_code: string;
}

export interface CliOAuthDeviceTokenResponse {
  status: CliOAuthDeviceStatus;
  access_token?: string;
  expires_in?: number;
  token_type?: "Bearer";
  user?: {
    email: string;
    name: string;
  };
}

export interface CliOAuthDeviceConfirmRequest {
  user_code: string;
}

export interface CliOAuthDeviceConfirmResponse {
  status: CliOAuthDeviceStatus;
  user_code: string;
}
