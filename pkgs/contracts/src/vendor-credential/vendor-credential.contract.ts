import type { AppId, VendorCredentialId } from "../id/id.contract";

export interface VendorCredential {
  apiBase: string | null;
  id: VendorCredentialId;
  isDefault: boolean;
  maskedApiKey: string;
  models: string[] | null;
  name: string;
  appId: AppId;
  vendorId: string;
}

export interface VendorCredentialSummary {
  id: VendorCredentialId;
  name: string;
  vendorId: string;
}

export interface CreateVendorCredentialInput {
  apiBase?: string | null;
  apiKey: string;
  models?: string[] | null;
  name: string;
  appId: AppId;
  vendorId: string;
}

export interface UpdateVendorCredentialInput {
  apiBase?: string | null;
  apiKey?: string;
  id: VendorCredentialId;
  models?: string[] | null;
  name?: string;
  appId: AppId;
}

export interface TestVendorCredentialInput {
  apiBase?: string | null;
  apiKey: string;
  modelId?: string | null;
  appId: AppId;
  vendorId: string;
}

export interface TestVendorCredentialResult {
  errorCode?: string | null;
  latencyMs: number;
  ok: boolean;
}

export interface DeleteVendorCredentialInput {
  id: VendorCredentialId;
  appId: AppId;
}

export interface SetDefaultVendorCredentialInput {
  id: VendorCredentialId;
  appId: AppId;
}
