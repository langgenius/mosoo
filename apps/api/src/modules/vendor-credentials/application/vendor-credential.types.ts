import type { VendorCredentialScope } from "@mosoo/contracts/vendor-credential";
import type { AccountId, OrganizationId, PlatformId, VendorCredentialId } from "@mosoo/id";

export interface VendorCredentialRow {
  apiBase: string | null;
  apiKeySecretId: PlatformId;
  id: VendorCredentialId;
  isDefault: number;
  isPreferred: number;
  modelsJson: string | null;
  name: string;
  ownerUserId: AccountId | null;
  vendorId: string;
  organizationId: OrganizationId;
}

export interface ResolvedVendorCredential {
  apiBase: string | null;
  apiKey: string;
  credentialId: VendorCredentialId;
  scope: VendorCredentialScope;
}
