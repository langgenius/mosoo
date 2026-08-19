import type { AppId } from "../id/id.contract";
import type { SessionRunStatus } from "../session/session-run.contract";
import type { JsonObject, JsonValue } from "../validation/primitives.contract";

export const HARNESS_SLUGS = ["claude-code", "openai-codex", "opencode"] as const;
export type HarnessSlug = (typeof HARNESS_SLUGS)[number];

export type HarnessAvailability = "available" | "unavailable";
export type HarnessCapabilityStatus = "native" | "normalized" | "unsupported";

export interface HarnessCapabilitySet {
  approve: HarnessCapabilityStatus;
  artifacts: HarnessCapabilityStatus;
  cancel: HarnessCapabilityStatus;
  resume: HarnessCapabilityStatus;
  stream: HarnessCapabilityStatus;
  subagents: HarnessCapabilityStatus;
}

export interface HarnessCatalogEntry {
  capabilities: HarnessCapabilitySet;
  defaultModel: string;
  description: string;
  environment: {
    default: "workspace";
    repositoryRequired: false;
  };
  label: string;
  quickstart: string;
  requiredCredentials: readonly string[];
  runtimeId: string;
  slug: HarnessSlug;
  status: HarnessAvailability;
  supportedModels: readonly string[];
  version: string;
}

export interface HarnessRunSourceInput {
  agent?: never;
  environment?: string;
  harness: HarnessSlug;
  model?: string;
}

export interface AgentRunSourceInput {
  agent: string;
  environment?: never;
  harness?: never;
  model?: never;
}

export type RunSourceInput = AgentRunSourceInput | HarnessRunSourceInput;

export type RunInput = JsonObject | JsonValue[] | boolean | number | string | null;

export type CreateWorkspaceRunRequest = RunSourceInput & {
  input: RunInput;
};

export interface AgentRunSourceSnapshot {
  agentId: string;
  agentVersionId: string | null;
  agentVersionNumber: number | null;
  kind: "agent";
}

export interface HarnessRunSourceSnapshot {
  harness: HarnessSlug;
  kind: "harness";
  version: string;
}

export type RunSourceSnapshot = AgentRunSourceSnapshot | HarnessRunSourceSnapshot;

export interface WorkspaceRunEnvironmentSnapshot {
  id: string;
  name: string;
  revisionId: string;
}

export interface WorkspaceRunLinks {
  approve: string;
  artifacts: string;
  cancel: string;
  events: string;
  result: string;
  stream: string;
}

export interface WorkspaceRunResponse {
  environment: WorkspaceRunEnvironmentSnapshot;
  id: string;
  links: WorkspaceRunLinks;
  model: string;
  source: RunSourceSnapshot;
  status: SessionRunStatus;
  threadId: string;
  workspaceId: AppId;
}

export interface WorkspaceRunArtifact {
  createdAt: string;
  id: string;
  mimeType: string | null;
  name: string;
  size: number;
}

export interface WorkspaceRunArtifactListResponse {
  artifacts: WorkspaceRunArtifact[];
}

export interface WorkspaceRunResultResponse {
  output: {
    text: string;
    warnings?: { code: string; count: number }[];
  } | null;
  run: WorkspaceRunResponse;
}
