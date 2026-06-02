import { AgentKind } from "@mosoo/contracts/agent";
import {
  ActiveMcpAuthorizationState,
  ActiveMcpCredentialStatus,
  McpAuthType,
  McpCredentialScope,
  UnavailableMcpAuthorizationState,
  UnavailableMcpCredentialStatus,
} from "@mosoo/contracts/mcp";
import type { SpaceAliasBinding as SpaceAliasBindingContract } from "@mosoo/contracts/sandbox";
import { SandboxSubjectKind, SpaceAliasBinding } from "@mosoo/contracts/sandbox";
import { NonEmptyString, parseSchemaValue } from "@mosoo/contracts/validation";
import { parsePlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  CredentialId,
  DriverInstanceId,
  EnvironmentId,
  EnvironmentRevisionId,
  FileId,
  McpServerId,
  PlatformId,
  SandboxId,
  SandboxSessionId,
  SessionId,
  SessionRunId,
  SkillId,
  SkillSnapshotId,
  SpaceId,
} from "@mosoo/id";
import { type } from "arktype";

import { DriverOrganizationAccessSnapshotOutput } from "../orpc/runtime-orpc-router";

export const DRIVER_PROTOCOL_VERSION = 1 as const;
export const DRIVER_CONTROL_PORT_MIN = 20_000 as const;
export const DRIVER_CONTROL_PORT_MAX = 59_999 as const;
export const DRIVER_CONTROL_PORT_COUNT = 40_000 as const;
export const DRIVER_BOOT_PAYLOAD_ENV_NAME = "MOSOO_DRIVER_BOOT_PAYLOAD";
export const DRIVER_BOOT_PAYLOAD_FILE_ENV_NAME = "MOSOO_DRIVER_BOOT_PAYLOAD_FILE";
export const SUPPORTED_DRIVER_RUNTIMES = [
  "openai-runtime",
  "claude-agent-sdk",
  "acp-fallback",
] as const;
export const SUPPORTED_DRIVER_RUNTIME_TRANSPORTS = [
  "openai-app-server",
  "claude-agent-sdk",
  "acp-fallback",
] as const;
export type DriverRuntime = (typeof SUPPORTED_DRIVER_RUNTIMES)[number];
export type DriverRuntimeTransport = (typeof SUPPORTED_DRIVER_RUNTIME_TRANSPORTS)[number];
export const SUPPORTED_DRIVER_NATIVE_RUNTIME_REF_KINDS = [
  "openai_thread_id",
  "claude_session_id",
  "acp_session_id",
] as const;
export type DriverNativeRuntimeRefKind = (typeof SUPPORTED_DRIVER_NATIVE_RUNTIME_REF_KINDS)[number];

export function isSupportedDriverRuntime(value: string): value is DriverRuntime {
  return (SUPPORTED_DRIVER_RUNTIMES as readonly string[]).includes(value);
}

export function isSupportedDriverRuntimeTransport(value: string): value is DriverRuntimeTransport {
  return (SUPPORTED_DRIVER_RUNTIME_TRANSPORTS as readonly string[]).includes(value);
}

export const DriverReadinessIssue = type({
  code: NonEmptyString,
  message: NonEmptyString,
  severity: '"error" | "warning"',
});
export type DriverReadinessIssue = typeof DriverReadinessIssue.infer;

export const DriverReadinessSnapshot = type({
  checkedAt: NonEmptyString,
  issues: DriverReadinessIssue.array(),
  ready: "boolean",
});
export type DriverReadinessSnapshot = typeof DriverReadinessSnapshot.infer;

export const DriverAgentsFileMount = type({
  fileId: NonEmptyString,
  mountPath: NonEmptyString,
});
type DriverAgentsFileMountInput = typeof DriverAgentsFileMount.infer;
export interface DriverAgentsFileMount extends Omit<DriverAgentsFileMountInput, "fileId"> {
  fileId: FileId;
}

export const DriverOrigin = type({
  callerUserId: NonEmptyString,
  entrypoint: '"api" | "chat"',
  executionOwnerUserId: NonEmptyString,
  type: '"agent"',
});
type DriverOriginInput = typeof DriverOrigin.infer;
export interface DriverOrigin extends Omit<
  DriverOriginInput,
  "callerUserId" | "executionOwnerUserId"
> {
  callerUserId: AccountId;
  executionOwnerUserId: AccountId;
}

export const DriverSandboxContext = type({
  id: NonEmptyString,
  kind: AgentKind,
  subjectId: NonEmptyString,
  subjectKind: SandboxSubjectKind,
});
type DriverSandboxContextInput = typeof DriverSandboxContext.infer;
export interface DriverSandboxContext extends Omit<DriverSandboxContextInput, "id" | "subjectId"> {
  id: SandboxId;
  subjectId: PlatformId;
}

export const DriverSessionContext = type({
  cloudflareSessionId: NonEmptyString,
  homePath: NonEmptyString,
  origin: DriverOrigin,
  sessionOrganizationPath: NonEmptyString,
  spaceAliases: SpaceAliasBinding.array(),
});
type DriverSessionContextInput = Omit<typeof DriverSessionContext.infer, "spaceAliases"> & {
  spaceAliases: SpaceAliasBindingContract[];
};
export interface DriverSessionContext extends Omit<
  DriverSessionContextInput,
  "cloudflareSessionId" | "origin" | "spaceAliases"
> {
  cloudflareSessionId: SandboxSessionId;
  origin: DriverOrigin;
  spaceAliases: SpaceAliasBindingContract[];
}

export const DriverConfigRevision = type({
  agentId: NonEmptyString,
  deploymentVersionId: NonEmptyString.or("null"),
  deploymentVersionNumber: "number | null",
  environmentId: NonEmptyString,
  environmentRevisionId: NonEmptyString,
  runId: NonEmptyString.or("null"),
  sessionId: NonEmptyString,
});
type DriverConfigRevisionInput = typeof DriverConfigRevision.infer;
export interface DriverConfigRevision extends Omit<
  DriverConfigRevisionInput,
  | "agentId"
  | "deploymentVersionId"
  | "environmentId"
  | "environmentRevisionId"
  | "runId"
  | "sessionId"
> {
  agentId: AgentId;
  deploymentVersionId: AgentDeploymentVersionId | null;
  environmentId: EnvironmentId;
  environmentRevisionId: EnvironmentRevisionId;
  runId: SessionRunId | null;
  sessionId: SessionId;
}

export const DriverProfileConfig = type({
  agentId: NonEmptyString,
  "agentsFile?": DriverAgentsFileMount.or("null"),
  configRevision: DriverConfigRevision,
  envVarNames: NonEmptyString.array(),
  envVars: {
    "[string]": "string",
  },
  kind: AgentKind,
  model: NonEmptyString,
  prompt: "string",
  provider: NonEmptyString,
  readiness: DriverReadinessSnapshot,
  runtimeId: '"openai-runtime" | "claude-agent-sdk" | "acp-fallback"',
  sandbox: DriverSandboxContext,
  session: DriverSessionContext,
  setupScript: "string",
  sourceKind: '"agent"',
});
type DriverProfileConfigInput = typeof DriverProfileConfig.infer;
export interface DriverProfileConfig extends Omit<
  DriverProfileConfigInput,
  "agentId" | "agentsFile" | "configRevision" | "sandbox" | "session"
> {
  agentsFile?: DriverAgentsFileMount | null;
  agentId: AgentId;
  configRevision: DriverConfigRevision;
  sandbox: DriverSandboxContext;
  session: DriverSessionContext;
}

export const DriverExecutionEnvironment = type({
  variables: {
    "[string]": "string",
  },
});
export type DriverExecutionEnvironment = typeof DriverExecutionEnvironment.infer;

export const DriverNativeRuntimeRef = type({
  kind: '"openai_thread_id" | "claude_session_id" | "acp_session_id"',
  runtimeId: '"openai-runtime" | "claude-agent-sdk" | "acp-fallback"',
  value: NonEmptyString,
});
export type DriverNativeRuntimeRef = typeof DriverNativeRuntimeRef.infer;

export const DriverResolvedSkill = type({
  archiveFormat: '"zip"',
  blobSha256: NonEmptyString,
  compression: '"deflate"',
  downloadUrl: NonEmptyString,
  materializationStatus: '"pending" | "ready" | "failed" | "skipped"',
  mountPath: NonEmptyString,
  resolutionMode: '"auto" | "explicit" | "tombstone"',
  skillId: NonEmptyString,
  skillName: NonEmptyString,
  "snapshotId?": "string | null",
  "warningCode?": "string | null",
});
type DriverResolvedSkillInput = typeof DriverResolvedSkill.infer;
export interface DriverResolvedSkill extends Omit<
  DriverResolvedSkillInput,
  "skillId" | "snapshotId"
> {
  skillId: SkillId;
  snapshotId?: SkillSnapshotId | null;
}

export const DriverSkillCatalogFrontmatterSummary = type({
  author: "string | null",
  description: "string | null",
  version: "string | null",
});
export type DriverSkillCatalogFrontmatterSummary =
  typeof DriverSkillCatalogFrontmatterSummary.infer;

export const DriverSkillCatalogEntry = type({
  frontmatter: DriverSkillCatalogFrontmatterSummary,
  mountPath: NonEmptyString,
  resolutionMode: '"auto" | "explicit" | "tombstone"',
  skillId: NonEmptyString,
  skillName: NonEmptyString,
});
type DriverSkillCatalogEntryInput = typeof DriverSkillCatalogEntry.infer;
export interface DriverSkillCatalogEntry extends Omit<DriverSkillCatalogEntryInput, "skillId"> {
  skillId: SkillId;
}

export const AuthorizedDriverResolvedMcpServer = type({
  authType: McpAuthType,
  authorizationState: ActiveMcpAuthorizationState,
  credentialId: NonEmptyString,
  credentialScope: McpCredentialScope,
  credentialStatus: ActiveMcpCredentialStatus,
  name: NonEmptyString,
  serverId: NonEmptyString,
  "subjectLabel?": "string | null",
});
type AuthorizedDriverResolvedMcpServerInput = typeof AuthorizedDriverResolvedMcpServer.infer;
export interface AuthorizedDriverResolvedMcpServer extends Omit<
  AuthorizedDriverResolvedMcpServerInput,
  "credentialId" | "serverId"
> {
  credentialId: CredentialId;
  serverId: McpServerId;
}

export const AuthorizedDriverBootMcpServer = type({
  authType: McpAuthType,
  authorizationState: ActiveMcpAuthorizationState,
  credentialId: NonEmptyString,
  credentialScope: McpCredentialScope,
  credentialStatus: ActiveMcpCredentialStatus,
  name: NonEmptyString,
  proxyGrantId: NonEmptyString,
  proxyUrl: NonEmptyString,
  serverId: NonEmptyString,
  "subjectLabel?": "string | null",
});
type AuthorizedDriverBootMcpServerInput = typeof AuthorizedDriverBootMcpServer.infer;
export interface AuthorizedDriverBootMcpServer extends Omit<
  AuthorizedDriverBootMcpServerInput,
  "credentialId" | "serverId"
> {
  credentialId: CredentialId;
  serverId: McpServerId;
}

export const UnavailableDriverResolvedMcpServer = type({
  authType: McpAuthType,
  authorizationState: UnavailableMcpAuthorizationState,
  credentialScope: McpCredentialScope,
  credentialStatus: UnavailableMcpCredentialStatus,
  name: NonEmptyString,
  serverId: NonEmptyString,
  "subjectLabel?": "string | null",
});
type UnavailableDriverResolvedMcpServerInput = typeof UnavailableDriverResolvedMcpServer.infer;
export interface UnavailableDriverResolvedMcpServer extends Omit<
  UnavailableDriverResolvedMcpServerInput,
  "serverId"
> {
  serverId: McpServerId;
}

export const DriverResolvedMcpServer = AuthorizedDriverResolvedMcpServer.or(
  UnavailableDriverResolvedMcpServer,
);
export type DriverResolvedMcpServer =
  | AuthorizedDriverResolvedMcpServer
  | UnavailableDriverResolvedMcpServer;

export const DriverBootMcpServer = AuthorizedDriverBootMcpServer.or(
  UnavailableDriverResolvedMcpServer,
);
type DriverBootMcpServerInput = typeof DriverBootMcpServer.infer;
export type DriverBootMcpServer =
  | AuthorizedDriverBootMcpServer
  | UnavailableDriverResolvedMcpServer;

export const DriverExecutionSessionContext = type({
  cloudflareSessionId: NonEmptyString,
  homePath: NonEmptyString,
  organizationAccessSnapshot: DriverOrganizationAccessSnapshotOutput,
  origin: DriverOrigin,
  sandboxId: NonEmptyString,
  sandboxKind: AgentKind,
  sandboxSubjectId: NonEmptyString,
  sandboxSubjectKind: SandboxSubjectKind,
  sessionOrganizationPath: NonEmptyString,
  spaceAliases: SpaceAliasBinding.array(),
});
type DriverExecutionSessionContextInput = Omit<
  typeof DriverExecutionSessionContext.infer,
  "spaceAliases"
> & {
  spaceAliases: SpaceAliasBindingContract[];
};
export interface DriverExecutionSessionContext extends Omit<
  DriverExecutionSessionContextInput,
  | "cloudflareSessionId"
  | "organizationAccessSnapshot"
  | "origin"
  | "sandboxId"
  | "sandboxSubjectId"
  | "spaceAliases"
> {
  cloudflareSessionId: SandboxSessionId;
  organizationAccessSnapshot: DriverOrganizationAccessSnapshotOutput;
  origin: DriverOrigin;
  sandboxId: SandboxId;
  sandboxSubjectId: PlatformId;
  spaceAliases: SpaceAliasBindingContract[];
}

export const DriverExecutionSessionSpec = type({
  additionalDirectories: NonEmptyString.array(),
  context: DriverExecutionSessionContext,
  cwd: NonEmptyString,
  mcpServers: DriverBootMcpServer.array(),
  nativeResumeRef: DriverNativeRuntimeRef.or("null"),
});
type DriverExecutionSessionSpecInput = typeof DriverExecutionSessionSpec.infer;
export interface DriverExecutionSessionSpec extends Omit<
  DriverExecutionSessionSpecInput,
  "context" | "mcpServers"
> {
  context: DriverExecutionSessionContext;
  mcpServers: DriverBootMcpServer[];
}

export const DriverExecutionSpec = type({
  configRevision: DriverConfigRevision,
  environment: DriverExecutionEnvironment,
  model: NonEmptyString,
  profilePrompt: "string",
  provider: NonEmptyString,
  session: DriverExecutionSessionSpec,
  skillCatalog: DriverSkillCatalogEntry.array(),
  skills: DriverResolvedSkill.array(),
});
type DriverExecutionSpecInput = typeof DriverExecutionSpec.infer;
export interface DriverExecutionSpec extends Omit<
  DriverExecutionSpecInput,
  "configRevision" | "session" | "skillCatalog" | "skills"
> {
  configRevision: DriverConfigRevision;
  session: DriverExecutionSessionSpec;
  skillCatalog: DriverSkillCatalogEntry[];
  skills: DriverResolvedSkill[];
}

export const DriverBootPayload = type({
  bootToken: NonEmptyString,
  driverControlPort: `${DRIVER_CONTROL_PORT_MIN} <= number.integer <= ${DRIVER_CONTROL_PORT_MAX}`,
  driverGeneration: "number.integer >= 0",
  driverInstanceId: NonEmptyString,
  execution: DriverExecutionSpec,
  heartbeatIntervalMs: "number >= 250",
  protocolVersion: "1",
  runtime: '"openai-runtime" | "claude-agent-sdk" | "acp-fallback"',
  runtimeTransport: '"openai-app-server" | "claude-agent-sdk" | "acp-fallback"',
  sandboxId: NonEmptyString,
  traceparent: NonEmptyString,
});
type DriverBootPayloadInput = typeof DriverBootPayload.infer;
export interface DriverBootPayload extends Omit<
  DriverBootPayloadInput,
  "driverInstanceId" | "execution" | "sandboxId"
> {
  driverInstanceId: DriverInstanceId;
  execution: DriverExecutionSpec;
  sandboxId: SandboxId;
}

function parseId(value: unknown, label: string): PlatformId {
  return parsePlatformId(value, label);
}

function parseNullableId(value: unknown, label: string): PlatformId | null {
  return value === null ? null : parseId(value, label);
}

function normalizeDriverOrigin(origin: DriverOriginInput): DriverOrigin {
  return {
    ...origin,
    callerUserId: parseId(origin.callerUserId, "Driver origin caller user ID") as AccountId,
    executionOwnerUserId: parseId(
      origin.executionOwnerUserId,
      "Driver origin execution owner user ID",
    ) as AccountId,
  };
}

function normalizeSpaceAliasBinding(alias: SpaceAliasBindingContract): SpaceAliasBindingContract {
  return {
    ...alias,
    spaceId: parseId(alias.spaceId, "Driver space alias space ID") as SpaceId,
  };
}

function normalizeDriverConfigRevision(revision: DriverConfigRevisionInput): DriverConfigRevision {
  return {
    ...revision,
    agentId: parseId(revision.agentId, "Driver config agent ID") as AgentId,
    deploymentVersionId: parseNullableId(
      revision.deploymentVersionId,
      "Driver config deployment version ID",
    ) as AgentDeploymentVersionId | null,
    environmentId: parseId(revision.environmentId, "Driver config environment ID") as EnvironmentId,
    environmentRevisionId: parseId(
      revision.environmentRevisionId,
      "Driver config environment revision ID",
    ) as EnvironmentRevisionId,
    runId: parseNullableId(revision.runId, "Driver config run ID") as SessionRunId | null,
    sessionId: parseId(revision.sessionId, "Driver config session ID") as SessionId,
  };
}

function normalizeDriverOrganizationAccessSnapshot(
  snapshot: DriverOrganizationAccessSnapshotOutput,
): DriverOrganizationAccessSnapshotOutput {
  return {
    entries: snapshot.entries.map((entry) => ({
      ...entry,
      spaceId: parseId(entry.spaceId, "Driver organization access space ID") as SpaceId,
    })),
  };
}

function normalizeDriverExecutionSessionContext(
  context: DriverExecutionSessionContextInput,
): DriverExecutionSessionContext {
  return {
    ...context,
    cloudflareSessionId: parseId(
      context.cloudflareSessionId,
      "Driver execution Cloudflare session ID",
    ) as SandboxSessionId,
    organizationAccessSnapshot: normalizeDriverOrganizationAccessSnapshot(
      context.organizationAccessSnapshot,
    ),
    origin: normalizeDriverOrigin(context.origin),
    sandboxId: parseId(context.sandboxId, "Driver execution sandbox ID") as SandboxId,
    sandboxSubjectId: parseId(context.sandboxSubjectId, "Driver execution sandbox subject ID"),
    spaceAliases: context.spaceAliases.map(normalizeSpaceAliasBinding),
  };
}

function normalizeDriverBootMcpServer(server: DriverBootMcpServerInput): DriverBootMcpServer {
  if (server.authorizationState === "active") {
    return {
      ...server,
      credentialId: parseId(server.credentialId, "Driver MCP credential ID") as CredentialId,
      serverId: parseId(server.serverId, "Driver MCP server ID") as McpServerId,
    };
  }

  return {
    ...server,
    serverId: parseId(server.serverId, "Driver MCP server ID") as McpServerId,
  };
}

function normalizeDriverExecutionSessionSpec(
  session: DriverExecutionSessionSpecInput,
): DriverExecutionSessionSpec {
  return {
    ...session,
    context: normalizeDriverExecutionSessionContext(
      session.context as DriverExecutionSessionContextInput,
    ),
    mcpServers: session.mcpServers.map(normalizeDriverBootMcpServer),
  };
}

function normalizeDriverResolvedSkill(skill: DriverResolvedSkillInput): DriverResolvedSkill {
  const { skillId, snapshotId, ...rest } = skill;

  return {
    ...rest,
    skillId: parseId(skillId, "Driver skill ID") as SkillId,
    ...(snapshotId === undefined
      ? {}
      : {
          snapshotId: parseNullableId(
            snapshotId,
            "Driver skill snapshot ID",
          ) as SkillSnapshotId | null,
        }),
  };
}

function normalizeDriverSkillCatalogEntry(
  entry: DriverSkillCatalogEntryInput,
): DriverSkillCatalogEntry {
  return {
    ...entry,
    skillId: parseId(entry.skillId, "Driver skill catalog skill ID") as SkillId,
  };
}

function normalizeDriverExecutionSpec(execution: DriverExecutionSpecInput): DriverExecutionSpec {
  return {
    ...execution,
    configRevision: normalizeDriverConfigRevision(execution.configRevision),
    session: normalizeDriverExecutionSessionSpec(execution.session),
    skillCatalog: execution.skillCatalog.map(normalizeDriverSkillCatalogEntry),
    skills: execution.skills.map(normalizeDriverResolvedSkill),
  };
}

function normalizeDriverBootPayload(payload: DriverBootPayloadInput): DriverBootPayload {
  return {
    ...payload,
    driverInstanceId: parseId(payload.driverInstanceId, "Driver instance ID") as DriverInstanceId,
    execution: normalizeDriverExecutionSpec(payload.execution),
    sandboxId: parseId(payload.sandboxId, "Driver sandbox ID") as SandboxId,
  };
}

export function parseDriverBootPayload(value: unknown): DriverBootPayload {
  return normalizeDriverBootPayload(parseSchemaValue(DriverBootPayload, value));
}

export function parseDriverBootPayloadJson(raw: string): DriverBootPayload {
  if (!raw.trim()) {
    throw new Error("Driver boot payload is empty.");
  }

  return parseDriverBootPayload(JSON.parse(raw));
}

export type DriverSpaceAliasBinding = SpaceAliasBindingContract;
