import type { AgentId, FileId, AppId } from "../id/id.contract";
import type { JsonObject } from "../validation/primitives.contract";
import { AGENT_MANIFEST_VERSION, AGENT_PACKAGE_VERSION } from "./agent-manifest-version.contract";
import type { AgentBuiltInToolConfig, AgentKind } from "./agent.contract";

export { AGENT_MANIFEST_VERSION, AGENT_PACKAGE_VERSION };

export type AgentManifestAssetRole = "avatar" | "logo";
export type AgentPackageAssetRole = AgentManifestAssetRole | "skill_file";
export type AgentResolutionSeverity = "error" | "info" | "warning";
export type AgentResolutionStatus =
  | "missing"
  | "needs_reconnect"
  | "permission_denied"
  | "resolved"
  | "unavailable"
  | "unsupported"
  | "warning";
export type AgentResolutionTargetType =
  | "agent"
  | "channel"
  | "environment"
  | "model"
  | "mcp_server"
  | "provider"
  | "runtime"
  | "skill";

export interface AgentResolutionIssue {
  actionLabel: string | null;
  code: string;
  message: string;
  required: boolean;
  severity: AgentResolutionSeverity;
  status: AgentResolutionStatus;
  targetLabel: string | null;
  targetType: AgentResolutionTargetType;
}

/**
 * Issue codes minted by the shared Agent package validation surface: the
 * package manifest checks (`collectPackageIssues`) plus the archive sidecar
 * validators in `@mosoo/agent-package`. `AgentResolutionIssue.code` stays a
 * plain string on the wire (other resolution surfaces mint their own codes),
 * but every minting site of THIS dialect and every downstream mapping layer
 * (agent package import, native deployment validate) must reference these
 * constants instead of raw strings so the reuse boundary cannot drift.
 */
export const AGENT_PACKAGE_ISSUE_CODES = {
  environmentFieldUnsupported: "package.environment.field.unsupported",
  environmentInvalid: "package.environment.invalid",
  environmentMissing: "package.environment.missing",
  environmentRefUnsupported: "package.environment.ref.unsupported",
  environmentSecretForbidden: "package.environment.secret_forbidden",
  fieldForbidden: "package.field.forbidden",
  fieldUnsupported: "package.field.unsupported",
  manifestKindMissing: "manifest.kind.missing",
  manifestModelMissing: "manifest.model.missing",
  manifestNameMissing: "manifest.metadata.name.missing",
  manifestPromptMissing: "manifest.prompt.missing",
  manifestRuntimeMissing: "manifest.runtime.missing",
  manifestVersionUnsupported: "manifest.version.unsupported",
  mcpFieldUnsupported: "package.mcp.field.unsupported",
  mcpMissing: "package.mcp.missing",
  mcpNameMissing: "package.mcp.name.missing",
  mcpRefMismatch: "package.mcp.ref.mismatch",
  mcpRefMissing: "package.mcp.ref.missing",
  mcpSecretForbidden: "package.mcp.secret_forbidden",
  mcpUndeclared: "package.mcp.undeclared",
  mcpUnsupported: "package.mcp.unsupported",
  mcpUrlInvalid: "package.mcp.url.invalid",
  packageSecretForbidden: "package.secret_forbidden",
  packageVersionUnsupported: "package.version.unsupported",
} as const;

export type AgentPackageIssueCode =
  (typeof AGENT_PACKAGE_ISSUE_CODES)[keyof typeof AGENT_PACKAGE_ISSUE_CODES];

export interface AgentManifestValidationResult {
  issues: AgentResolutionIssue[];
  manifest: AgentManifest | null;
}

export interface AgentManifestAssetReference {
  assetId: string | null;
  assetKey: string | null;
  filename: string;
  mimeType: string | null;
  mountPath: string;
  role: AgentManifestAssetRole;
}

export interface AgentManifestSkillReference {
  ownerName: string | null;
  skillId: string;
  skillName: string;
  state: "active" | "tombstone";
}

export interface AgentManifestMcpServerBinding {
  authType: "bearer" | "oauth";
  credentialMode: "agent_bound" | "runtime_resolved";
  credentialScope: "app";
  enabled: boolean;
  iconUrl: string | null;
  name: string;
  serverId: string | null;
  source: "app";
  url: string;
}

export interface AgentManifestEnvironmentReference {
  environmentId: string | null;
  expectedName: string | null;
  envVars: Record<string, string>;
  setupScript: string;
}

export interface AgentManifestAdvanced {
  unparsedFields: Record<string, unknown>;
}

export interface AgentManifest {
  advanced: AgentManifestAdvanced | null;
  builtInTools: AgentBuiltInToolConfig[];
  environment: AgentManifestEnvironmentReference;
  kind: AgentKind;
  manifestVersion: typeof AGENT_MANIFEST_VERSION;
  mcpServers: AgentManifestMcpServerBinding[];
  metadata: {
    description: string | null;
    name: string;
  };
  prompts: {
    system: string;
  };
  runtime: {
    id: string;
    model: string;
    provider: string;
    providerOptions: JsonObject;
  };
  skills: AgentManifestSkillReference[];
}

export interface AgentPackageAsset {
  contentBytes?: Uint8Array;
  contentText: string | null;
  filename: string;
  key: string;
  mimeType: string | null;
  role: AgentPackageAssetRole;
  size: number;
}

export interface AgentPackage {
  author: {
    email: string | null;
    name: string;
  } | null;
  app: {
    avatarAssetKey: string | null;
    description: string | null;
    name: string;
  };
  assets: AgentPackageAsset[];
  exportedAt: string;
  license: string | null;
  manifest: AgentManifest;
  packageVersion: typeof AGENT_PACKAGE_VERSION;
  sourceAgentId: string | null;
  version: string | null;
}

export interface AgentPackageResolutionSummary {
  boundMcpServerCount: number;
  boundSkillCount: number;
  copiedAssetCount: number;
  createdMcpServerCount: number;
  reusedMcpServerCount: number;
}

export interface AgentPackageResolutionReport {
  issues: AgentResolutionIssue[];
  summary: AgentPackageResolutionSummary;
}

export type AgentPackageResolutionSource = "fork" | "import";

export interface AgentPackageResolutionState {
  recordedAt: string;
  report: AgentPackageResolutionReport;
  source: AgentPackageResolutionSource;
}

export interface AgentManifestExport {
  agentId: AgentId;
  json: string;
  yaml: string;
}

export interface AgentPackageExport {
  agentId: AgentId;
  contentType: "application/zip";
  fileId: FileId;
  fileName: string;
  manifestYaml: string;
  size: number;
}

export interface ImportAgentPackageInput {
  fileId: FileId;
  appId: AppId;
}

export interface CreateAgentForkInput {
  agentId: AgentId;
  kind?: AgentKind;
  appId: AppId;
}

export interface AgentPackageImportResult<AgentModel = unknown> {
  agent: AgentModel;
  resolution: AgentPackageResolutionReport;
}
