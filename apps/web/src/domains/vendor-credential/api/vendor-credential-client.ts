import type { AccountId, OrganizationId, VendorCredentialId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toAccountId, toOrganizationId, toVendorCredentialId } from "@/routes/typed-id";

import { parseAvailableModelReason, parseModelCatalogSource } from "./model-catalog-parsers";

const VENDOR_CREDENTIAL_LIST_QUERY = graphql(/* GraphQL */ `
  query VendorCredentialList($organizationId: ULID!) {
    vendorCredentialList(organizationId: $organizationId) {
      apiBase
      id
      isDefault
      isPreferred
      maskedApiKey
      models
      name
      ownerUserId
      scope
      vendorId
      organizationId
    }
  }
`);

const CREATE_VENDOR_CREDENTIAL_MUTATION = graphql(/* GraphQL */ `
  mutation CreateVendorCredential($input: CreateVendorCredentialInput!) {
    createVendorCredential(input: $input) {
      apiBase
      id
      isDefault
      isPreferred
      maskedApiKey
      models
      name
      ownerUserId
      scope
      vendorId
      organizationId
    }
  }
`);

const UPDATE_VENDOR_CREDENTIAL_MUTATION = graphql(/* GraphQL */ `
  mutation UpdateVendorCredential($input: UpdateVendorCredentialInput!) {
    updateVendorCredential(input: $input) {
      apiBase
      id
      isDefault
      isPreferred
      maskedApiKey
      models
      name
      ownerUserId
      scope
      vendorId
      organizationId
    }
  }
`);

const DELETE_VENDOR_CREDENTIAL_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteVendorCredential($input: DeleteVendorCredentialInput!) {
    deleteVendorCredential(input: $input) {
      ok
    }
  }
`);

const AVAILABLE_AGENT_MODELS_QUERY = graphql(/* GraphQL */ `
  query AvailableAgentModels(
    $runtimeId: String!
    $currentModelId: String
    $currentVendorId: String
  ) {
    availableAgentModels(
      runtimeId: $runtimeId
      currentModelId: $currentModelId
      currentVendorId: $currentVendorId
    ) {
      available
      displayName
      modelId
      reason
      source
      statusDetail
      statusLabel
      vendorId
      vendorLabel
    }
  }
`);

const TEST_VENDOR_CREDENTIAL_MUTATION = graphql(/* GraphQL */ `
  mutation TestVendorCredential($input: TestVendorCredentialInput!) {
    testVendorCredential(input: $input) {
      errorCode
      latencyMs
      ok
    }
  }
`);

export interface VendorCredential {
  apiBase: string | null;
  id: VendorCredentialId;
  isDefault: boolean;
  isPreferred: boolean;
  maskedApiKey: string;
  models: string[] | null;
  name: string;
  ownerUserId: AccountId | null;
  scope: "company" | "personal";
  vendorId: string;
  organizationId: OrganizationId;
}

type GraphQLVendorCredential = Omit<VendorCredential, "id" | "organizationId" | "ownerUserId"> & {
  id: string;
  organizationId: string;
  ownerUserId: string | null;
};

function toVendorCredential(credential: GraphQLVendorCredential): VendorCredential {
  return {
    ...credential,
    id: toVendorCredentialId(credential.id),
    organizationId: toOrganizationId(credential.organizationId),
    ownerUserId: credential.ownerUserId === null ? null : toAccountId(credential.ownerUserId),
  };
}

export async function listVendorCredentials(
  organizationId: OrganizationId,
): Promise<VendorCredential[]> {
  const payload = await requestGraphQL(VENDOR_CREDENTIAL_LIST_QUERY, { organizationId });
  return payload.vendorCredentialList.map(toVendorCredential);
}

export async function createVendorCredential(input: {
  apiBase?: string | null;
  apiKey: string;
  isDefault?: boolean;
  isPreferred?: boolean;
  models?: string[];
  name: string;
  scope?: "company" | "personal";
  vendorId: string;
  organizationId: OrganizationId;
}): Promise<VendorCredential> {
  const payload = await requestGraphQL(CREATE_VENDOR_CREDENTIAL_MUTATION, { input });
  return toVendorCredential(payload.createVendorCredential);
}

export async function updateVendorCredential(input: {
  apiBase?: string | null;
  apiKey?: string;
  id: VendorCredentialId;
  isDefault?: boolean;
  isPreferred?: boolean;
  models?: string[];
  name?: string;
}): Promise<VendorCredential> {
  const payload = await requestGraphQL(UPDATE_VENDOR_CREDENTIAL_MUTATION, { input });
  return toVendorCredential(payload.updateVendorCredential);
}

export async function deleteVendorCredential(id: VendorCredentialId): Promise<void> {
  await requestGraphQL(DELETE_VENDOR_CREDENTIAL_MUTATION, { input: { id } });
}

export type ModelCatalogSource = "preset" | "custom";
export type AvailableModelReason =
  | "needs-key"
  | "unknown-model"
  | "unknown-provider"
  | "wrong-runtime";

export interface ResolvedModelEntry {
  available: boolean;
  displayName: string;
  modelId: string;
  reason: AvailableModelReason | null;
  source: ModelCatalogSource;
  statusDetail: string | null;
  statusLabel: string;
  vendorId: string;
  vendorLabel: string;
}

export async function listAvailableAgentModels(input: {
  runtimeId: string;
  currentModelId?: string | null;
  currentVendorId?: string | null;
}): Promise<ResolvedModelEntry[]> {
  const payload = await requestGraphQL(AVAILABLE_AGENT_MODELS_QUERY, {
    currentModelId: input.currentModelId ?? null,
    currentVendorId: input.currentVendorId ?? null,
    runtimeId: input.runtimeId,
  });
  return payload.availableAgentModels.map((entry) => ({
    available: entry.available,
    displayName: entry.displayName,
    modelId: entry.modelId,
    reason: parseAvailableModelReason(entry.reason),
    source: parseModelCatalogSource(entry.source),
    statusDetail: entry.statusDetail,
    statusLabel: entry.statusLabel,
    vendorId: entry.vendorId,
    vendorLabel: entry.vendorLabel,
  }));
}

export async function testVendorCredential(input: {
  apiBase?: string | null;
  apiKey: string;
  modelId?: string | null;
  organizationId: OrganizationId;
  scope?: "company" | "personal";
  vendorId: string;
}): Promise<{ errorCode: string | null; latencyMs: number; ok: boolean }> {
  const payload = await requestGraphQL(TEST_VENDOR_CREDENTIAL_MUTATION, { input });
  return payload.testVendorCredential;
}
