import type { AppId, VendorCredentialId } from "@mosoo/contracts/id";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toAppId, toVendorCredentialId } from "@/routes/typed-id";

import { parseAvailableModelReason, parseModelCatalogSource } from "./model-catalog-parsers";

const VENDOR_CREDENTIAL_LIST_QUERY = graphql(/* GraphQL */ `
  query VendorCredentialList($appId: ULID!) {
    vendorCredentialList(appId: $appId) {
      apiBase
      id
      isDefault
      maskedApiKey
      models
      name
      appId
      vendorId
    }
  }
`);

const CREATE_VENDOR_CREDENTIAL_MUTATION = graphql(/* GraphQL */ `
  mutation CreateVendorCredential($input: CreateVendorCredentialInput!) {
    createVendorCredential(input: $input) {
      apiBase
      id
      isDefault
      maskedApiKey
      models
      name
      appId
      vendorId
    }
  }
`);

const UPDATE_VENDOR_CREDENTIAL_MUTATION = graphql(/* GraphQL */ `
  mutation UpdateVendorCredential($input: UpdateVendorCredentialInput!) {
    updateVendorCredential(input: $input) {
      apiBase
      id
      isDefault
      maskedApiKey
      models
      name
      appId
      vendorId
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

const SET_DEFAULT_VENDOR_CREDENTIAL_MUTATION = graphql(/* GraphQL */ `
  mutation SetDefaultVendorCredential($input: SetDefaultVendorCredentialInput!) {
    setDefaultVendorCredential(input: $input) {
      apiBase
      id
      isDefault
      maskedApiKey
      models
      name
      appId
      vendorId
    }
  }
`);

const AVAILABLE_AGENT_MODELS_QUERY = graphql(/* GraphQL */ `
  query AvailableAgentModels(
    $appId: ULID!
    $runtimeId: String!
    $currentModelId: String
    $currentVendorId: String
  ) {
    availableAgentModels(
      appId: $appId
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
  maskedApiKey: string;
  models: string[] | null;
  name: string;
  appId: AppId;
  vendorId: string;
}

type GraphQLVendorCredential = Omit<VendorCredential, "id" | "appId"> & {
  id: string;
  appId: string;
};

function toVendorCredential(credential: GraphQLVendorCredential): VendorCredential {
  return {
    ...credential,
    id: toVendorCredentialId(credential.id),
    appId: toAppId(credential.appId),
  };
}

export async function listVendorCredentials(appId: AppId): Promise<VendorCredential[]> {
  const payload = await requestGraphQL(VENDOR_CREDENTIAL_LIST_QUERY, { appId });
  return payload.vendorCredentialList.map(toVendorCredential);
}

export async function createVendorCredential(input: {
  apiBase?: string | null;
  apiKey: string;
  models?: string[];
  name: string;
  appId: AppId;
  vendorId: string;
}): Promise<VendorCredential> {
  const payload = await requestGraphQL(CREATE_VENDOR_CREDENTIAL_MUTATION, { input });
  return toVendorCredential(payload.createVendorCredential);
}

export async function updateVendorCredential(input: {
  apiBase?: string | null;
  apiKey?: string;
  id: VendorCredentialId;
  models?: string[];
  name?: string;
  appId: AppId;
}): Promise<VendorCredential> {
  const payload = await requestGraphQL(UPDATE_VENDOR_CREDENTIAL_MUTATION, { input });
  return toVendorCredential(payload.updateVendorCredential);
}

export async function deleteVendorCredential(input: {
  id: VendorCredentialId;
  appId: AppId;
}): Promise<void> {
  await requestGraphQL(DELETE_VENDOR_CREDENTIAL_MUTATION, { input });
}

export async function setDefaultVendorCredential(input: {
  id: VendorCredentialId;
  appId: AppId;
}): Promise<VendorCredential> {
  const payload = await requestGraphQL(SET_DEFAULT_VENDOR_CREDENTIAL_MUTATION, { input });
  return toVendorCredential(payload.setDefaultVendorCredential);
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
  appId: AppId;
  runtimeId: string;
  currentModelId?: string | null;
  currentVendorId?: string | null;
}): Promise<ResolvedModelEntry[]> {
  const payload = await requestGraphQL(AVAILABLE_AGENT_MODELS_QUERY, {
    currentModelId: input.currentModelId ?? null,
    currentVendorId: input.currentVendorId ?? null,
    appId: input.appId,
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
  appId: AppId;
  vendorId: string;
}): Promise<{ errorCode: string | null; latencyMs: number; ok: boolean }> {
  const payload = await requestGraphQL(TEST_VENDOR_CREDENTIAL_MUTATION, { input });
  return payload.testVendorCredential;
}
