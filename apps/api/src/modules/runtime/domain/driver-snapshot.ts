import type { JsonObject } from "@mosoo/contracts";
import type { AgentKind, AgentReadiness } from "@mosoo/contracts/agent";
import type {
  ActiveMcpAuthorizationState,
  ActiveMcpCredentialStatus,
  McpAuthType,
  McpCredentialScope,
  UnavailableMcpAuthorizationState,
  UnavailableMcpCredentialStatus,
} from "@mosoo/contracts/mcp";
import type { SandboxSubjectKind, SpaceAliasBinding } from "@mosoo/contracts/sandbox";
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
  SandboxId,
  SandboxSessionId,
  SessionId,
  SessionRunId,
  SkillId,
  SkillSnapshotId,
  SpaceId,
} from "@mosoo/id";
import type { DriverNativeRuntimeRef, DriverRuntime } from "agent-driver/runtime";

export type { DriverRuntime };

export interface DriverOrganizationAccessSnapshotEntry {
  readonly mountPath: string;
  readonly role: "admin" | "edit" | "read";
  readonly spaceId: SpaceId;
  readonly type: "space";
}

export interface DriverOrganizationAccessSnapshotOutput {
  readonly entries: DriverOrganizationAccessSnapshotEntry[];
}

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
  readonly spaceAliases: SpaceAliasBinding[];
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

export interface DriverProfileConfig {
  readonly agentId: AgentId;
  readonly configRevision: DriverConfigRevision;
  readonly envVarNames: string[];
  readonly envVars: Record<string, string>;
  readonly kind: AgentKind;
  readonly model: string;
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
  readonly serverId: McpServerId;
  readonly subjectLabel?: string | null | undefined;
}

export interface UnavailableDriverResolvedMcpServer {
  readonly authType: McpAuthType;
  readonly authorizationState: UnavailableMcpAuthorizationState;
  readonly credentialScope: McpCredentialScope;
  readonly credentialStatus: UnavailableMcpCredentialStatus;
  readonly name: string;
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
  readonly organizationAccessSnapshot: DriverOrganizationAccessSnapshotOutput;
  readonly origin: DriverOrigin;
  readonly sandboxId: SandboxId;
  readonly sandboxKind: AgentKind;
  readonly sandboxSubjectId: PlatformId;
  readonly sandboxSubjectKind: SandboxSubjectKind;
  readonly sessionOrganizationPath: string;
  readonly spaceAliases: SpaceAliasBinding[];
}

export interface DriverExecutionSessionSpec {
  readonly additionalDirectories: string[];
  readonly context: DriverExecutionSessionContext;
  readonly cwd: string;
  readonly mcpServers: DriverBootMcpServer[];
  readonly nativeResumeRef: DriverNativeRuntimeRef | null;
}

export interface DriverExecutionSpec {
  readonly configRevision: DriverConfigRevision;
  readonly environment: DriverExecutionEnvironment;
  readonly model: string;
  readonly profilePrompt: string;
  readonly provider: string;
  readonly providerOptions: JsonObject;
  readonly session: DriverExecutionSessionSpec;
  readonly skillCatalog: DriverSkillCatalogEntry[];
  readonly skills: DriverResolvedSkill[];
}
