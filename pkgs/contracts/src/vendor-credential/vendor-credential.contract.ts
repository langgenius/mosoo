import type { AccountId, OrganizationId, VendorCredentialId } from "../id/id.contract";

export type VendorCredentialScope = "company" | "personal";

export interface VendorCredential {
  apiBase: string | null;
  disabledByPolicy: boolean;
  id: VendorCredentialId;
  isDefault: boolean;
  isPreferred: boolean;
  maskedApiKey: string;
  models: string[] | null;
  name: string;
  ownerUserId: AccountId | null;
  scope: VendorCredentialScope;
  vendorId: string;
  organizationId: OrganizationId;
}

export interface VendorCredentialSummary {
  id: VendorCredentialId;
  name: string;
  vendorId: string;
}

export interface CredentialPolicy {
  allowedProviderIds: string[];
  byokEnabled: boolean;
  organizationId: OrganizationId;
}

export interface VendorCredentialCapability {
  organizationId: OrganizationId;
  personalCredentialAllowed: boolean;
  providerAllowed: boolean;
  vendorId: string;
}

export interface CreateVendorCredentialInput {
  apiBase?: string | null;
  apiKey: string;
  isDefault?: boolean;
  isPreferred?: boolean;
  models?: string[] | null;
  name: string;
  scope?: VendorCredentialScope;
  vendorId: string;
  organizationId: OrganizationId;
}

export interface UpdateVendorCredentialInput {
  apiBase?: string | null;
  apiKey?: string;
  id: VendorCredentialId;
  isDefault?: boolean;
  isPreferred?: boolean;
  models?: string[] | null;
  name?: string;
}

export interface TestVendorCredentialInput {
  apiBase?: string | null;
  apiKey: string;
  modelId?: string | null;
  organizationId: OrganizationId;
  scope?: VendorCredentialScope;
  vendorId: string;
}

export interface TestVendorCredentialResult {
  errorCode?: string | null;
  latencyMs: number;
  ok: boolean;
}

export interface DeleteVendorCredentialInput {
  id: VendorCredentialId;
}

export interface UpdateCredentialPolicyInput {
  allowedProviderIds: string[];
  byokEnabled: boolean;
  organizationId: OrganizationId;
}
