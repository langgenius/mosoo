export const vendorCredentialSchema = /* GraphQL */ `
  type VendorCredential {
    apiBase: String
    id: ULID!
    isDefault: Boolean!
    maskedApiKey: String!
    models: [String!]
    name: String!
    projectId: ULID!
    vendorId: String!
  }

  input CreateVendorCredentialInput {
    apiBase: String
    apiKey: String!
    models: [String!]
    name: String!
    projectId: ULID!
    vendorId: String!
  }

  input UpdateVendorCredentialInput {
    apiBase: String
    apiKey: String
    id: ULID!
    models: [String!]
    name: String
    projectId: ULID!
  }

  input DeleteVendorCredentialInput {
    id: ULID!
    projectId: ULID!
  }

  input SetDefaultVendorCredentialInput {
    id: ULID!
    projectId: ULID!
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
    projectId: ULID!
    vendorId: String!
  }

  type TestVendorCredentialResult {
    errorCode: String
    latencyMs: Int!
    ok: Boolean!
  }
`;
