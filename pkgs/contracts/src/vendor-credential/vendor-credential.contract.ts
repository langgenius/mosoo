import type { PresetModelProtocol } from "../../models/model-catalog.types";
import type { ProjectId, VendorCredentialId } from "../id/id.contract";

export interface VendorCredential {
  apiBase: string | null;
  id: VendorCredentialId;
  isDefault: boolean;
  maskedApiKey: string;
  modelProtocol?: PresetModelProtocol | null;
  models: string[] | null;
  name: string;
  projectId: ProjectId;
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
  modelProtocol?: PresetModelProtocol | null;
  models?: string[] | null;
  name: string;
  projectId: ProjectId;
  vendorId: string;
}

export interface UpdateVendorCredentialInput {
  apiBase?: string | null;
  apiKey?: string;
  id: VendorCredentialId;
  modelProtocol?: PresetModelProtocol | null;
  models?: string[] | null;
  name?: string;
  projectId: ProjectId;
}

export interface TestVendorCredentialInput {
  apiBase?: string | null;
  apiKey: string;
  modelId?: string | null;
  modelProtocol?: PresetModelProtocol | null;
  projectId: ProjectId;
  vendorId: string;
}

export interface TestVendorCredentialResult {
  errorCode?: string | null;
  latencyMs: number;
  ok: boolean;
}

export interface DeleteVendorCredentialInput {
  id: VendorCredentialId;
  projectId: ProjectId;
}

export interface SetDefaultVendorCredentialInput {
  id: VendorCredentialId;
  projectId: ProjectId;
}
