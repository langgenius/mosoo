import type { PlatformId, AppId, VendorCredentialId } from "@mosoo/id";

export interface VendorCredentialRow {
  apiBase: string | null;
  apiKeySecretId: PlatformId;
  id: VendorCredentialId;
  isDefault: boolean;
  modelsJson: string[] | null;
  name: string;
  appId: AppId;
  vendorId: string;
}

export interface ResolvedVendorCredential {
  apiBase: string | null;
  apiKey: string;
  credentialId: VendorCredentialId;
  models: string[] | null;
}

/**
 * Secret-free view of a runtime vendor credential. Run hydration resolves this
 * instead of {@link ResolvedVendorCredential} so the raw API key never enters
 * driver profiles, boot payloads, or sandbox environments; the key itself is
 * only read back inside the Worker when the LLM proxy forwards a request.
 */
export interface ResolvedVendorCredentialRef {
  apiBase: string | null;
  appId: AppId;
  credentialId: VendorCredentialId;
  models: string[] | null;
  vendorId: string;
}
