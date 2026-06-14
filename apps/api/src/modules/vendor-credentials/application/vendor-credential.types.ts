import type { OrganizationId, PlatformId, AppId, VendorCredentialId } from "@mosoo/id";

export interface VendorCredentialRow {
  apiBase: string | null;
  apiKeySecretId: PlatformId;
  id: VendorCredentialId;
  modelsJson: string[] | null;
  name: string;
  organizationId: OrganizationId;
  appId: AppId;
  vendorId: string;
}

export interface ResolvedVendorCredential {
  apiBase: string | null;
  apiKey: string;
  credentialId: VendorCredentialId;
}
