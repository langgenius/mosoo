export const vendorCredentialSchema = /* GraphQL */ `
  type VendorCredential {
    apiBase: String
    id: ULID!
    isDefault: Boolean!
    isPreferred: Boolean!
    maskedApiKey: String!
    models: [String!]
    name: String!
    ownerUserId: ULID
    scope: VendorCredentialScope!
    vendorId: String!
    organizationId: ULID!
  }

  enum VendorCredentialScope {
    company
    personal
  }

  input CreateVendorCredentialInput {
    apiBase: String
    apiKey: String!
    isDefault: Boolean
    isPreferred: Boolean
    models: [String!]
    name: String!
    scope: VendorCredentialScope
    vendorId: String!
    organizationId: ULID!
  }

  input UpdateVendorCredentialInput {
    apiBase: String
    apiKey: String
    id: ULID!
    isDefault: Boolean
    isPreferred: Boolean
    models: [String!]
    name: String
  }

  input DeleteVendorCredentialInput {
    id: ULID!
  }

  type ResolvedModelEntry {
    available: Boolean!
    displayName: String!
    modelId: String!
    reason: String
    source: ModelCatalogSource!
    statusDetail: String
    statusLabel: String!
    vendorId: String!
    vendorLabel: String!
  }

  enum ModelCatalogSource {
    custom
    preset
  }

  input TestVendorCredentialInput {
    apiBase: String
    apiKey: String!
    modelId: String
    organizationId: ULID!
    scope: VendorCredentialScope
    vendorId: String!
  }

  type TestVendorCredentialResult {
    errorCode: String
    latencyMs: Int!
    ok: Boolean!
  }
`;
