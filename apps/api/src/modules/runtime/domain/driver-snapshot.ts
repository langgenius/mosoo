import type { JsonObject } from "@mosoo/contracts";
import type { AgentBuiltInToolConfig, AgentKind, AgentReadiness } from "@mosoo/contracts/agent";
import type {
  ActiveMcpAuthorizationState,
  ActiveMcpCredentialStatus,
  McpAuthType,
  McpCredentialScope,
  UnavailableMcpAuthorizationState,
  UnavailableMcpCredentialStatus,
} from "@mosoo/contracts/mcp";
import type { SandboxSubjectKind } from "@mosoo/contracts/sandbox";
import type { SkillMaterializationStatus, SkillResolutionMode } from "@mosoo/contracts/skill";
import type {
  AccountId,
  AgentDeploymentVersionId,
  AgentId,
  CredentialId,
  EnvironmentId,
  EnvironmentRevisionId,
  McpServerId,
  PlatformId,
  AppId,
  SandboxId,
  SandboxSessionId,
  SessionId,
  SessionRunId,
  SkillId,
  SkillSnapshotId,
} from "@mosoo/id";
import type { DriverRecoveryMessage } from "agent-driver/boot";
import type { DriverNativeRuntimeRef, DriverRuntime } from "agent-driver/runtime";

export type { DriverRuntime };

export interface DriverOrigin {
  readonly callerUserId: AccountId;
  readonly entrypoint: "api" | "chat";
  readonly executionOwnerUserId: AccountId;
  readonly type: "agent";
}

export interface DriverSandboxContext {
  readonly id: SandboxId;
  readonly kind: AgentKind;
  readonly subjectId: PlatformId;
  readonly subjectKind: SandboxSubjectKind;
}

export interface DriverSessionContext {
  readonly sandboxSessionId: SandboxSessionId;
  readonly homePath: string;
  readonly origin: DriverOrigin;
  readonly sessionOrganizationPath: string;
}

export interface DriverConfigRevision {
  readonly agentId: AgentId;
  readonly deploymentVersionId: AgentDeploymentVersionId | null;
  readonly deploymentVersionNumber: number | null;
  readonly environmentId: EnvironmentId;
  readonly environmentRevisionId: EnvironmentRevisionId;
  readonly runId: SessionRunId | null;
  readonly sessionId: SessionId;
}

/**
 * How the driver mediates tool-permission requests. Mirrors the driver-side
 * `DriverPermissionPolicy` (agent-driver). `full_access` (default) = the
 * sandbox is the isolation boundary, tool calls auto-approved with no
 * control-plane round-trip; `supervised` = route every tool call to the
 * permission broker for an interactive decision.
 */
export type DriverPermissionPolicy = "full_access" | "supervised";

export const DEFAULT_DRIVER_PERMISSION_POLICY = "full_access" satisfies DriverPermissionPolicy;

export interface DriverProfileConfig {
  readonly agentId: AgentId;
  readonly configRevision: DriverConfigRevision;
  readonly envVarNames: string[];
  readonly envVars: Record<string, string>;
  readonly kind: AgentKind;
  readonly model: string;
  readonly permissionPolicy: DriverPermissionPolicy;
  readonly prompt: string;
  readonly provider: string;
  readonly providerOptions: JsonObject;
  readonly readiness: AgentReadiness;
  readonly runtimeId: DriverRuntime;
  readonly sandbox: DriverSandboxContext;
  readonly session: DriverSessionContext;
  readonly setupScript: string;
  readonly sourceKind: "agent";
}

export interface DriverSkillCatalogFrontmatterSummary {
  readonly author: string | null;
  readonly description: string | null;
  readonly version: string | null;
}

export interface DriverSkillCatalogEntry {
  readonly frontmatter: DriverSkillCatalogFrontmatterSummary;
  readonly mountPath: string;
  readonly resolutionMode: SkillResolutionMode;
  readonly skillId: SkillId;
  readonly skillName: string;
}

export interface DriverResolvedSkill {
  readonly archiveFormat: "zip";
  readonly blobSha256: string;
  readonly compression: "deflate";
  readonly downloadUrl: string;
  readonly materializationStatus: SkillMaterializationStatus;
  readonly mountPath: string;
  readonly resolutionMode: SkillResolutionMode;
  readonly skillId: SkillId;
  readonly skillName: string;
  readonly snapshotId?: SkillSnapshotId | null | undefined;
  readonly warningCode?: string | null | undefined;
}

export interface AuthorizedDriverResolvedMcpServer {
  readonly authType: McpAuthType;
  readonly authorizationState: ActiveMcpAuthorizationState;
  readonly credentialId: CredentialId;
  readonly credentialScope: McpCredentialScope;
  readonly credentialStatus: ActiveMcpCredentialStatus;
  readonly name: string;
  readonly appId: AppId;
  readonly serverId: McpServerId;
  readonly subjectLabel?: string | null | undefined;
}

export interface UnavailableDriverResolvedMcpServer {
  readonly authType: McpAuthType;
  readonly authorizationState: UnavailableMcpAuthorizationState;
  readonly credentialScope: McpCredentialScope;
  readonly credentialStatus: UnavailableMcpCredentialStatus;
  readonly name: string;
  readonly appId: AppId;
  readonly serverId: McpServerId;
  readonly subjectLabel?: string | null | undefined;
}

export type DriverResolvedMcpServer =
  | AuthorizedDriverResolvedMcpServer
  | UnavailableDriverResolvedMcpServer;

export interface AuthorizedDriverBootMcpServer extends AuthorizedDriverResolvedMcpServer {
  readonly proxyGrantId: string;
  readonly proxyUrl: string;
}

export type DriverBootMcpServer =
  | AuthorizedDriverBootMcpServer
  | UnavailableDriverResolvedMcpServer;

export interface DriverExecutionEnvironment {
  readonly variables: Record<string, string>;
}

export interface DriverExecutionSessionContext {
  readonly sandboxSessionId: SandboxSessionId;
  readonly homePath: string;
  readonly origin: DriverOrigin;
  readonly sandboxId: SandboxId;
  readonly sandboxKind: AgentKind;
  readonly sandboxSubjectId: PlatformId;
  readonly sandboxSubjectKind: SandboxSubjectKind;
  readonly sessionOrganizationPath: string;
}

export interface DriverExecutionSessionSpec {
  readonly additionalDirectories: string[];
  readonly context: DriverExecutionSessionContext;
  readonly cwd: string;
  readonly mcpServers: DriverBootMcpServer[];
  readonly nativeResumeRef: DriverNativeRuntimeRef | null;
  readonly recoveryMessages: DriverRecoveryMessage[];
}

export interface DriverExecutionSpec {
  readonly builtInTools: AgentBuiltInToolConfig[];
  readonly configRevision: DriverConfigRevision;
  readonly environment: DriverExecutionEnvironment;
  readonly model: string;
  readonly permissionPolicy: DriverPermissionPolicy;
  readonly profilePrompt: string;
  readonly provider: string;
  readonly providerOptions: JsonObject;
  readonly session: DriverExecutionSessionSpec;
  readonly skillCatalog: DriverSkillCatalogEntry[];
  readonly skills: DriverResolvedSkill[];
}
