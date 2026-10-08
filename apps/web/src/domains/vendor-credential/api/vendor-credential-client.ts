import type { ProjectId, VendorCredentialId } from "@mosoo/contracts/id";
import type { PresetModelProtocol } from "@mosoo/contracts/models";

import { graphql } from "@/gql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { toProjectId, toVendorCredentialId } from "@/routes/typed-id";

import {
  parseAvailableModelReason,
  parseModelCatalogSource,
  parseModelProtocol,
} from "./model-catalog-parsers";

const VENDOR_CREDENTIAL_LIST_QUERY = graphql(/* GraphQL */ `
  query VendorCredentialList($projectId: ULID!) {
    vendorCredentialList(projectId: $projectId) {
      apiBase
      id
      isDefault
      maskedApiKey
      modelProtocol
      models
      name
      projectId
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
      modelProtocol
      models
      name
      projectId
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
      modelProtocol
      models
      name
      projectId
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
      modelProtocol
      models
      name
      projectId
      vendorId
    }
  }
`);

const AVAILABLE_AGENT_MODELS_QUERY = graphql(/* GraphQL */ `
  query AvailableAgentModels(
    $projectId: ULID!
    $runtimeId: String!
    $currentModelId: String
    $currentVendorId: String
  ) {
    availableAgentModels(
      projectId: $projectId
      runtimeId: $runtimeId
      currentModelId: $currentModelId
      currentVendorId: $currentVendorId
    ) {
      available
      displayName
      modelId
      modelProtocol
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
  modelProtocol: PresetModelProtocol | null;
  models: string[] | null;
  name: string;
  projectId: ProjectId;
  vendorId: string;
}

type GraphQLVendorCredential = Omit<VendorCredential, "id" | "projectId" | "modelProtocol"> & {
  id: string;
  modelProtocol: string | null;
  projectId: string;
};

function toVendorCredential(credential: GraphQLVendorCredential): VendorCredential {
  return {
    ...credential,
    id: toVendorCredentialId(credential.id),
    modelProtocol: parseModelProtocol(credential.modelProtocol),
    projectId: toProjectId(credential.projectId),
  };
}

export async function listVendorCredentials(projectId: ProjectId): Promise<VendorCredential[]> {
  const payload = await requestGraphQL(VENDOR_CREDENTIAL_LIST_QUERY, { projectId });
  return payload.vendorCredentialList.map(toVendorCredential);
}

export async function createVendorCredential(input: {
  apiBase?: string | null;
  apiKey: string;
  modelProtocol?: PresetModelProtocol | null;
  models?: string[];
  name: string;
  projectId: ProjectId;
  vendorId: string;
}): Promise<VendorCredential> {
  const payload = await requestGraphQL(CREATE_VENDOR_CREDENTIAL_MUTATION, { input });
  return toVendorCredential(payload.createVendorCredential);
}

export async function updateVendorCredential(input: {
  apiBase?: string | null;
  apiKey?: string;
  id: VendorCredentialId;
  modelProtocol?: PresetModelProtocol | null;
  models?: string[];
  name?: string;
  projectId: ProjectId;
}): Promise<VendorCredential> {
  const payload = await requestGraphQL(UPDATE_VENDOR_CREDENTIAL_MUTATION, { input });
  return toVendorCredential(payload.updateVendorCredential);
}

export async function deleteVendorCredential(input: {
  id: VendorCredentialId;
  projectId: ProjectId;
}): Promise<void> {
  await requestGraphQL(DELETE_VENDOR_CREDENTIAL_MUTATION, { input });
}

export async function setDefaultVendorCredential(input: {
  id: VendorCredentialId;
  projectId: ProjectId;
}): Promise<VendorCredential> {
  const payload = await requestGraphQL(SET_DEFAULT_VENDOR_CREDENTIAL_MUTATION, { input });
  return toVendorCredential(payload.setDefaultVendorCredential);
}

export type ModelCatalogSource = "preset" | "custom";
export type AvailableModelReason =
  | "needs-key"
  | "unknown-model"
  | "unknown-provider"
  | "wrong-protocol"
  | "wrong-runtime";

export interface ResolvedModelEntry {
  available: boolean;
  displayName: string;
  modelId: string;
  modelProtocol: PresetModelProtocol | null;
  reason: AvailableModelReason | null;
  source: ModelCatalogSource;
  statusDetail: string | null;
  statusLabel: string;
  vendorId: string;
  vendorLabel: string;
}

export async function listAvailableAgentModels(input: {
  projectId: ProjectId;
  runtimeId: string;
  currentModelId?: string | null;
  currentVendorId?: string | null;
}): Promise<ResolvedModelEntry[]> {
  const payload = await requestGraphQL(AVAILABLE_AGENT_MODELS_QUERY, {
    currentModelId: input.currentModelId ?? null,
    currentVendorId: input.currentVendorId ?? null,
    projectId: input.projectId,
    runtimeId: input.runtimeId,
  });
  return payload.availableAgentModels.map((entry) => ({
    available: entry.available,
    displayName: entry.displayName,
    modelId: entry.modelId,
    modelProtocol: parseModelProtocol(entry.modelProtocol),
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
  modelProtocol?: PresetModelProtocol | null;
  projectId: ProjectId;
  vendorId: string;
}): Promise<{ errorCode: string | null; latencyMs: number; ok: boolean }> {
  const payload = await requestGraphQL(TEST_VENDOR_CREDENTIAL_MUTATION, { input });
  return payload.testVendorCredential;
}
