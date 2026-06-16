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
}
