import type { AgentKind, AgentStatus } from "../agent/agent.contract";
import type {
  AgentBuilderMessageId,
  AgentBuilderPlannerRunId,
  AgentBuilderThreadId,
  AgentId,
  EnvironmentId,
  McpServerId,
  OrganizationId,
  SkillId,
  SkillSnapshotId,
  SpaceId,
} from "../id/id.contract";
import type {
  AgentBuilderAskUserMode,
  AgentBuilderComponentDecisions,
  AgentBuilderPlanNodeActionKey,
  AgentBuilderPreviewStageSnapshot,
} from "./agent-builder-control-plane.contract";

export type AgentBuilderPlannerResponseMode =
  | "action"
  | "blocked"
  | "draft_patch"
  | "plain_text"
  | "question";

export type AgentBuilderPlanNodeKind = Exclude<AgentBuilderPlannerResponseMode, "plain_text">;

export type AgentBuilderPlanNodeStatus = "applied" | "blocked" | "failed" | "pending";

export type AgentBuilderPlanNodeTargetType =
  | "draft"
  | "environment"
  | "mcp"
  | "skill"
  | "space"
  | "workflow";

export type AgentBuilderPlanNodeOperation =
  | "ask"
  | "bind"
  | "blocked"
  | "remove"
  | "show"
  | "update";

export type AgentBuilderPlanNodeActionStyle = "danger" | "primary" | "secondary";

export interface AgentBuilderPlanNodeAction {
  actionKey: AgentBuilderPlanNodeActionKey;
  label: string;
  style: AgentBuilderPlanNodeActionStyle;
}

export interface AgentBuilderAskUserOption {
  description?: string;
  label: string;
  optionKey: string;
  value?: string;
}

export interface AgentBuilderAskUserQuestion {
  allowCustomText: boolean;
  allowSkip: boolean;
  mode: AgentBuilderAskUserMode;
  options: AgentBuilderAskUserOption[];
  prompt: string;
  submitLabel?: string;
}

export type AgentBuilderDraftPatchFieldPath =
  | "componentDecisions.environment"
  | "description"
  | "environmentId"
  | "kind"
  | "model"
  | "mcpServerIds"
  | "name"
  | "prompt"
  | "provider"
  | "runtimeId"
  | "skillIds"
  | "spaceIds";

export type AgentBuilderDraftPatchSectionId = "basics" | "environment" | "integrations";

export type AgentBuilderDraftPatchValue = null | string | string[];

export type AgentBuilderDraftPatchOperation = Extract<
  AgentBuilderPlanNodeOperation,
  "bind" | "remove" | "update"
>;

export type AgentBuilderDraftPatchReferenceTargetType =
  | "environment"
  | "mcp_server"
  | "skill"
  | "space";
export type AgentBuilderDraftPatchReferenceId = EnvironmentId | McpServerId | SkillId | SpaceId;

export type AgentBuilderVisibleAssetBindingState = "bound" | "not_bound" | "not_represented";

export const AGENT_BUILDER_VISIBLE_ASSET_BINDING_STATE_VALUES = [
  "bound",
  "not_bound",
  "not_represented",
] as const satisfies readonly AgentBuilderVisibleAssetBindingState[];

export interface AgentBuilderDraftPatchReference {
  bindingState: AgentBuilderVisibleAssetBindingState;
  filename?: string;
  id: AgentBuilderDraftPatchReferenceId;
  name: string;
  targetType: AgentBuilderDraftPatchReferenceTargetType;
  url?: string;
}

export interface AgentBuilderDraftPatchChange {
  autoApply?: boolean;
  baseDraftRevision?: string;
  baseValue?: AgentBuilderDraftPatchValue;
  fieldPath: AgentBuilderDraftPatchFieldPath;
  resolvedReferences?: AgentBuilderDraftPatchReference[];
  sectionId?: AgentBuilderDraftPatchSectionId;
  value: AgentBuilderDraftPatchValue;
}

export interface AgentBuilderPlanNode {
  actions: AgentBuilderPlanNodeAction[];
  askUser?: AgentBuilderAskUserQuestion;
  draftPatch?: AgentBuilderDraftPatchChange;
  fieldPath?: string;
  kind: AgentBuilderPlanNodeKind;
  nodeKey: string;
  operation: AgentBuilderPlanNodeOperation;
  requiresConfirmation: boolean;
  status: AgentBuilderPlanNodeStatus;
  summary: string;
  targetType: AgentBuilderPlanNodeTargetType;
}

export interface AgentBuilderPlannerOutput {
  assistantText: string;
  intentSummary: string;
  mode: AgentBuilderPlannerResponseMode;
  nodes: AgentBuilderPlanNode[];
  plannerRunId: AgentBuilderPlannerRunId;
  version: 1;
}

export const AGENT_BUILDER_PLANNER_RESPONSE_MODE_VALUES = [
  "action",
  "blocked",
  "draft_patch",
  "plain_text",
  "question",
] as const satisfies readonly AgentBuilderPlannerResponseMode[];

export const AGENT_BUILDER_PLAN_NODE_OPERATION_VALUES = [
  "ask",
  "bind",
  "blocked",
  "remove",
  "show",
  "update",
] as const satisfies readonly AgentBuilderPlanNodeOperation[];

export const AGENT_BUILDER_DRAFT_PATCH_OPERATION_VALUES = [
  "bind",
  "remove",
  "update",
] as const satisfies readonly AgentBuilderDraftPatchOperation[];

export const AGENT_BUILDER_DRAFT_PATCH_FIELD_PATH_VALUES = [
  "componentDecisions.environment",
  "name",
  "description",
  "kind",
  "prompt",
  "runtimeId",
  "provider",
  "model",
  "environmentId",
  "skillIds",
  "mcpServerIds",
  "spaceIds",
] as const satisfies readonly AgentBuilderDraftPatchFieldPath[];

export const AGENT_BUILDER_DRAFT_PATCH_SECTION_ID_VALUES = [
  "basics",
  "environment",
  "integrations",
] as const satisfies readonly AgentBuilderDraftPatchSectionId[];

export const AGENT_BUILDER_DRAFT_PATCH_REFERENCE_TARGET_TYPE_VALUES = [
  "environment",
  "mcp_server",
  "skill",
  "space",
] as const satisfies readonly AgentBuilderDraftPatchReferenceTargetType[];

export type AgentBuilderDraftPatchAssetFieldPath = Extract<
  AgentBuilderDraftPatchFieldPath,
  "environmentId" | "mcpServerIds" | "skillIds" | "spaceIds"
>;

export type AgentBuilderVisibleAssetIndexListKey =
  | "environments"
  | "mcpServers"
  | "skills"
  | "spaces";

export type AgentBuilderBindableAssetField = "environment" | "mcpServer" | "skill" | "space";

export interface AgentBuilderDraftPatchAssetFieldSpec {
  assetField: AgentBuilderBindableAssetField;
  fieldPath: AgentBuilderDraftPatchAssetFieldPath;
  listKey: AgentBuilderVisibleAssetIndexListKey;
  sectionId: AgentBuilderDraftPatchSectionId;
  targetType: AgentBuilderDraftPatchReferenceTargetType;
  visibleAssetKind: Extract<
    AgentBuilderVisibleAssetKind,
    "environment" | "mcp_server" | "skill" | "space"
  >;
}

export const AGENT_BUILDER_DRAFT_PATCH_ASSET_FIELD_PATH_VALUES = [
  "environmentId",
  "mcpServerIds",
  "skillIds",
  "spaceIds",
] as const satisfies readonly AgentBuilderDraftPatchAssetFieldPath[];

export const AGENT_BUILDER_DRAFT_PATCH_ASSET_FIELD_SPECS = {
  environmentId: {
    assetField: "environment",
    fieldPath: "environmentId",
    listKey: "environments",
    sectionId: "environment",
    targetType: "environment",
    visibleAssetKind: "environment",
  },
  mcpServerIds: {
    assetField: "mcpServer",
    fieldPath: "mcpServerIds",
    listKey: "mcpServers",
    sectionId: "integrations",
    targetType: "mcp_server",
    visibleAssetKind: "mcp_server",
  },
  skillIds: {
    assetField: "skill",
    fieldPath: "skillIds",
    listKey: "skills",
    sectionId: "integrations",
    targetType: "skill",
    visibleAssetKind: "skill",
  },
  spaceIds: {
    assetField: "space",
    fieldPath: "spaceIds",
    listKey: "spaces",
    sectionId: "environment",
    targetType: "space",
    visibleAssetKind: "space",
  },
} as const satisfies Record<
  AgentBuilderDraftPatchAssetFieldPath,
  AgentBuilderDraftPatchAssetFieldSpec
>;

export const AGENT_BUILDER_BINDABLE_ASSET_FIELD_SPECS = {
  environment: AGENT_BUILDER_DRAFT_PATCH_ASSET_FIELD_SPECS.environmentId,
  mcpServer: AGENT_BUILDER_DRAFT_PATCH_ASSET_FIELD_SPECS.mcpServerIds,
  skill: AGENT_BUILDER_DRAFT_PATCH_ASSET_FIELD_SPECS.skillIds,
  space: AGENT_BUILDER_DRAFT_PATCH_ASSET_FIELD_SPECS.spaceIds,
} as const satisfies Record<AgentBuilderBindableAssetField, AgentBuilderDraftPatchAssetFieldSpec>;

export const AGENT_BUILDER_DRAFT_PATCH_FIELD_PATH_ALIASES: Readonly<
  Record<string, AgentBuilderDraftPatchFieldPath>
> = {
  "assets.mcpServerIds": "mcpServerIds",
  "assets.mcpServers": "mcpServerIds",
  "assets.skillIds": "skillIds",
  "assets.skills": "skillIds",
  "assets.spaceIds": "spaceIds",
  "assets.spaces": "spaceIds",
  "builder.componentDecisions.environment": "componentDecisions.environment",
  "environment.environmentId": "environmentId",
  "identity.description": "description",
  "identity.name": "name",
  agentType: "kind",
  type: "kind",
  "runtime.id": "runtimeId",
  "runtime.model": "model",
  "runtime.provider": "provider",
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function isAgentBuilderPlanNodeOperation(
  value: unknown,
): value is AgentBuilderPlanNodeOperation {
  return (
    typeof value === "string" &&
    (AGENT_BUILDER_PLAN_NODE_OPERATION_VALUES as readonly string[]).includes(value)
  );
}

export function isAgentBuilderDraftPatchOperation(
  value: unknown,
): value is AgentBuilderDraftPatchOperation {
  return (
    typeof value === "string" &&
    (AGENT_BUILDER_DRAFT_PATCH_OPERATION_VALUES as readonly string[]).includes(value)
  );
}

export function isAgentBuilderDraftPatchFieldPath(
  value: unknown,
): value is AgentBuilderDraftPatchFieldPath {
  return (
    typeof value === "string" &&
    (AGENT_BUILDER_DRAFT_PATCH_FIELD_PATH_VALUES as readonly string[]).includes(value)
  );
}

export function resolveAgentBuilderDraftPatchFieldPath(
  value: unknown,
): AgentBuilderDraftPatchFieldPath | null {
  if (typeof value !== "string") {
    return null;
  }

  const fieldPath = value.trim();
  const canonicalValue = AGENT_BUILDER_DRAFT_PATCH_FIELD_PATH_ALIASES[fieldPath] ?? fieldPath;

  return isAgentBuilderDraftPatchFieldPath(canonicalValue) ? canonicalValue : null;
}

export function isAgentBuilderDraftPatchSectionId(
  value: unknown,
): value is AgentBuilderDraftPatchSectionId {
  return (
    typeof value === "string" &&
    (AGENT_BUILDER_DRAFT_PATCH_SECTION_ID_VALUES as readonly string[]).includes(value)
  );
}

export function isAgentBuilderDraftPatchReferenceTargetType(
  value: unknown,
): value is AgentBuilderDraftPatchReferenceTargetType {
  return (
    typeof value === "string" &&
    (AGENT_BUILDER_DRAFT_PATCH_REFERENCE_TARGET_TYPE_VALUES as readonly string[]).includes(value)
  );
}

export function isAgentBuilderVisibleAssetBindingState(
  value: unknown,
): value is AgentBuilderVisibleAssetBindingState {
  return (
    typeof value === "string" &&
    (AGENT_BUILDER_VISIBLE_ASSET_BINDING_STATE_VALUES as readonly string[]).includes(value)
  );
}

export function isAgentBuilderDraftPatchAssetFieldPath(
  value: unknown,
): value is AgentBuilderDraftPatchAssetFieldPath {
  return (
    typeof value === "string" &&
    (AGENT_BUILDER_DRAFT_PATCH_ASSET_FIELD_PATH_VALUES as readonly string[]).includes(value)
  );
}

export function getAgentBuilderDraftPatchAssetFieldSpec(
  fieldPath: AgentBuilderDraftPatchFieldPath,
): AgentBuilderDraftPatchAssetFieldSpec | null {
  return isAgentBuilderDraftPatchAssetFieldPath(fieldPath)
    ? AGENT_BUILDER_DRAFT_PATCH_ASSET_FIELD_SPECS[fieldPath]
    : null;
}

export function getAgentBuilderBindableAssetFieldSpec(
  assetField: AgentBuilderBindableAssetField,
): AgentBuilderDraftPatchAssetFieldSpec {
  return AGENT_BUILDER_BINDABLE_ASSET_FIELD_SPECS[assetField];
}

export function isAgentBuilderDraftPatchValue(
  value: unknown,
): value is AgentBuilderDraftPatchValue {
  return value === null || typeof value === "string" || isStringArray(value);
}

export function getAgentBuilderDraftPatchSectionId(
  fieldPath: AgentBuilderDraftPatchFieldPath,
): AgentBuilderDraftPatchSectionId {
  if (fieldPath === "skillIds" || fieldPath === "mcpServerIds") {
    return "integrations";
  }

  if (
    fieldPath === "componentDecisions.environment" ||
    fieldPath === "environmentId" ||
    fieldPath === "spaceIds"
  ) {
    return "environment";
  }

  return "basics";
}

export type AgentBuilderPlannerTurnInputKind =
  | "confirmation"
  | "guidance_event"
  | "question_answer"
  | "user_message";

export interface AgentBuilderPlannerConversationMessage {
  contentText: string;
  role: "assistant" | "system" | "tool" | "user";
  seq: number;
}

export interface AgentBuilderPlannerDraftContext {
  revision: string;
  yaml: string;
}

export type AgentBuilderVisibleAssetKind =
  | "environment"
  | "mcp_server"
  | "selected_space_files"
  | "skill"
  | "space";

export interface AgentBuilderVisibleAssetIndexEntry {
  bindingState: AgentBuilderVisibleAssetBindingState;
  hash: string;
  id: string;
  kind: AgentBuilderVisibleAssetKind;
  name: string;
}

export interface AgentBuilderRemovedVisibleAsset {
  bindingState: AgentBuilderVisibleAssetBindingState;
  hash: string;
  id: string;
  kind: AgentBuilderVisibleAssetKind;
  name: string;
}

export interface AgentBuilderVisibleAssetChangeSet<TAsset> {
  added: TAsset[];
  removed: AgentBuilderRemovedVisibleAsset[];
  updated: TAsset[];
}

export interface AgentBuilderVisibleSkillSummary {
  bindingState: AgentBuilderVisibleAssetBindingState;
  description: string;
  hash: string;
  id: SkillId;
  name: string;
  ownerName: string;
  snapshotId: SkillSnapshotId;
  sourceKind: string;
  updatedAt: string;
}

export interface AgentBuilderVisibleMcpServerSummary {
  authType: string;
  authorizationState: string;
  bindingState: AgentBuilderVisibleAssetBindingState;
  credentialScope: string;
  credentialStatus: string;
  description: string | null;
  enabled: boolean;
  hash: string;
  id: McpServerId;
  name: string;
  source: string;
  updatedAt: string;
  urlHost: string;
}

export interface AgentBuilderVisibleEnvironmentSummary {
  allowMcpServers: boolean;
  allowPackageManagers: boolean;
  bindingState: AgentBuilderVisibleAssetBindingState;
  description: string;
  envVarKeys: string[];
  hash: string;
  id: EnvironmentId;
  isBuiltIn: boolean;
  isDefault: boolean;
  name: string;
  networkPolicy: string;
  packageManagers: string[];
  setupScriptConfigured: boolean;
  updatedAt: string;
}

export interface AgentBuilderVisibleSpaceSummary {
  bindingState: AgentBuilderVisibleAssetBindingState;
  hash: string;
  id: SpaceId;
  name: string;
  role: string;
  visibility: string;
}

export interface AgentBuilderSelectedSpaceFilesSummary {
  bindingState: "bound";
  directories: string[];
  directoryCount: number;
  files: {
    key: string;
    mimeType: string | null;
    size: number;
  }[];
  fileCount: number;
  hash: string;
  id: SpaceId;
  listingState: "available" | "unavailable";
  name: string;
  unavailableReason: string | null;
}

export interface AgentBuilderPlannerDraftBindingsContext {
  componentDecisions: AgentBuilderComponentDecisions;
  environmentId: EnvironmentId | null;
  mcpServerIds: McpServerId[];
  parseError: string | null;
  parseStatus: "failed" | "parsed";
  skillIds: SkillId[];
  spaceIds: SpaceId[];
}

export type AgentBuilderPreviousVisibleAssetsContextStatus = "available" | "invalid" | "missing";

export interface AgentBuilderPreviousVisibleAssetsContext {
  errorMessage: string | null;
  status: AgentBuilderPreviousVisibleAssetsContextStatus;
}

export interface AgentBuilderVisibleAssetsContext {
  changesSinceLastTurn: {
    environments: AgentBuilderVisibleAssetChangeSet<AgentBuilderVisibleEnvironmentSummary>;
    mcpServers: AgentBuilderVisibleAssetChangeSet<AgentBuilderVisibleMcpServerSummary>;
    selectedSpaceFiles: AgentBuilderVisibleAssetChangeSet<AgentBuilderSelectedSpaceFilesSummary>;
    skills: AgentBuilderVisibleAssetChangeSet<AgentBuilderVisibleSkillSummary>;
    spaces: AgentBuilderVisibleAssetChangeSet<AgentBuilderVisibleSpaceSummary>;
  };
  currentIndex: {
    environments: AgentBuilderVisibleAssetIndexEntry[];
    mcpServers: AgentBuilderVisibleAssetIndexEntry[];
    selectedSpaceFiles: AgentBuilderVisibleAssetIndexEntry[];
    skills: AgentBuilderVisibleAssetIndexEntry[];
    spaces: AgentBuilderVisibleAssetIndexEntry[];
  };
  draftBindings: AgentBuilderPlannerDraftBindingsContext;
  observedAt: string;
  previousContext: AgentBuilderPreviousVisibleAssetsContext;
  snapshotHash: string;
}

export interface AgentBuilderPlannerBoundaryPolicy {
  allowedModes: AgentBuilderPlannerResponseMode[];
  forbiddenWrites: string[];
  requiresLlmPlanner: boolean;
}

export interface AgentBuilderReadinessIssueSummary {
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface AgentBuilderReadinessContext {
  checkedAt: string;
  errorCount: number;
  issues: AgentBuilderReadinessIssueSummary[];
  ready: boolean;
  warningCount: number;
}

export interface AgentBuilderPlannerSystemAgentContext {
  credentialSource: "provider_database";
  model: {
    modelId: string;
    provider: string;
  } | null;
}

export interface AgentBuilderPlannerAgentContext {
  agentId: AgentId;
  baseConfigApplied: boolean;
  kind: AgentKind;
  organizationId: OrganizationId;
  status: AgentStatus;
}

export interface AgentBuilderPlannerConversationContext {
  recentMessages: AgentBuilderPlannerConversationMessage[];
}

export interface AgentBuilderPlannerMemoryDiagnostic {
  code: "invalid_planner_output";
  message: string;
  plannerRunId: AgentBuilderPlannerRunId;
  severity: "warning";
}

export interface AgentBuilderPlannerMemoryContext {
  diagnostics: AgentBuilderPlannerMemoryDiagnostic[];
}

export interface AgentBuilderPlannerTurnContext {
  inputKind: AgentBuilderPlannerTurnInputKind;
  inputText: string;
  triggerMessageId: AgentBuilderMessageId;
}

export interface AgentBuilderPlannerContext {
  agent: AgentBuilderPlannerAgentContext;
  boundaryPolicy: AgentBuilderPlannerBoundaryPolicy;
  assets: AgentBuilderVisibleAssetsContext;
  conversation: AgentBuilderPlannerConversationContext;
  draft: AgentBuilderPlannerDraftContext;
  historicalOpenNodes: AgentBuilderPlanNode[];
  memory: AgentBuilderPlannerMemoryContext;
  plannerRunId: AgentBuilderPlannerRunId;
  preview: AgentBuilderPreviewStageSnapshot;
  readiness: AgentBuilderReadinessContext;
  systemAgent: AgentBuilderPlannerSystemAgentContext;
  threadId: AgentBuilderThreadId;
  turn: AgentBuilderPlannerTurnContext;
  version: 1;
}
