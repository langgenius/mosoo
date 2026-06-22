import { parsePlatformId } from "@mosoo/id";
import type {
  CredentialId,
  DriverInstanceId,
  McpServerId,
  SessionRunId,
  SkillSnapshotId,
} from "@mosoo/id";
import type { DriverNativeRuntimeRef } from "agent-driver/runtime";

import { appendRuntimeArtifactContextToPrompt } from "../../application/session-artifacts/session-artifact-prompt.service";
import type {
  DriverBootMcpServer,
  DriverExecutionSpec,
  DriverProfileConfig,
  DriverResolvedMcpServer,
  DriverResolvedSkill,
  DriverSkillCatalogEntry,
} from "../../domain/driver-snapshot";
import { RUNTIME_ACTION_TOKEN_TTL_MS, RUNTIME_RUN_RETENTION_MS } from "../../domain/runtime-config";
import {
  getRuntimeDriverMcpProxyPath,
  getRuntimeDriverSkillPackagePath,
} from "../../domain/runtime-driver-routes";
import type { DriverInstanceMcpGrantRecord } from "../driver-instance/mcp-grants.repository";
import { createRuntimeActionToken } from "../runtime-boot-token";
import type { RuntimeActionTokenBindings } from "../runtime-boot-token";
import {
  getOrganizationPath,
  listAdditionalDirectories,
} from "./runtime-sandbox-provisioning.paths";

interface RuntimeActionUrlContext {
  bindings: RuntimeExecutionSpecBindings;
  driverInstanceId: DriverInstanceId;
  requestUrl: string;
}

export type RuntimeExecutionSpecBindings = RuntimeActionTokenBindings;

export function toDriverInstanceMcpGrantRecord(
  server: DriverResolvedMcpServer,
): DriverInstanceMcpGrantRecord {
  const canManageCredential =
    server.authorizationState === "active" &&
    server.authType === "oauth" &&
    "credentialId" in server;

  return {
    authType: server.authType,
    authorizationState: server.authorizationState,
    canInvalidate: canManageCredential,
    canRefresh: canManageCredential,
    credentialId:
      "credentialId" in server
        ? parsePlatformId<CredentialId>(server.credentialId, "MCP credential id")
        : null,
    appId: server.appId,
    serverId: parsePlatformId<McpServerId>(server.serverId, "MCP server id"),
  };
}

function getRuntimeMcpProxyUrl(requestUrl: string, serverId: McpServerId): string {
  const url = new URL(requestUrl);
  url.pathname = getRuntimeDriverMcpProxyPath(serverId);
  url.search = "";
  return url.toString();
}

async function withRuntimeMcpProxy(
  context: RuntimeActionUrlContext,
  server: DriverResolvedMcpServer,
): Promise<DriverBootMcpServer> {
  const serverId = parsePlatformId<McpServerId>(server.serverId, "MCP server id");

  if (server.authorizationState !== "active" || !("credentialId" in server)) {
    return {
      authType: server.authType,
      authorizationState: server.authorizationState,
      credentialScope: server.credentialScope,
      credentialStatus: server.credentialStatus,
      name: server.name,
      appId: server.appId,
      serverId,
      subjectLabel: server.subjectLabel ?? null,
    };
  }

  const credentialId = parsePlatformId<CredentialId>(server.credentialId, "MCP credential id");

  return {
    authType: server.authType,
    authorizationState: "active",
    credentialId,
    credentialScope: server.credentialScope,
    credentialStatus: "active",
    name: server.name,
    appId: server.appId,
    proxyGrantId: await createRuntimeActionToken(context.bindings, {
      action: "mcp_proxy",
      driverInstanceId: context.driverInstanceId,
      expiresAt: Date.now() + RUNTIME_RUN_RETENTION_MS,
      resourceId: serverId,
    }),
    proxyUrl: getRuntimeMcpProxyUrl(context.requestUrl, serverId),
    serverId,
    subjectLabel: server.subjectLabel ?? null,
  };
}

async function toRuntimeSkillDownloadUrl(
  context: RuntimeActionUrlContext,
  snapshotId: SkillSnapshotId,
): Promise<string> {
  const url = new URL(context.requestUrl);
  url.pathname = getRuntimeDriverSkillPackagePath(snapshotId);
  url.search = "";
  url.searchParams.set(
    "grant",
    await createRuntimeActionToken(context.bindings, {
      action: "skill_snapshot",
      driverInstanceId: context.driverInstanceId,
      expiresAt: Date.now() + RUNTIME_ACTION_TOKEN_TTL_MS,
      resourceId: snapshotId,
    }),
  );
  return url.toString();
}

async function toRuntimeResolvedSkill(
  context: RuntimeActionUrlContext,
  skill: Omit<DriverResolvedSkill, "downloadUrl">,
): Promise<DriverResolvedSkill> {
  if (skill.snapshotId === undefined || skill.snapshotId === null || skill.snapshotId === "") {
    return {
      ...skill,
      downloadUrl: "https://invalid.local/tombstone.skill",
    };
  }

  const snapshotId = parsePlatformId<SkillSnapshotId>(skill.snapshotId, "skill snapshot id");

  return {
    ...skill,
    downloadUrl: await toRuntimeSkillDownloadUrl(context, snapshotId),
  };
}

export async function buildExecutionSpec(
  bindings: RuntimeExecutionSpecBindings,
  input: {
    driverInstanceId: DriverInstanceId;
    profile: DriverProfileConfig;
    requestUrl: string;
    resolvedMcpServers: DriverResolvedMcpServer[];
    nativeResumeRef?: DriverNativeRuntimeRef | null;
    resolvedSkillCatalog: DriverSkillCatalogEntry[];
    resolvedSkills: Omit<DriverResolvedSkill, "downloadUrl">[];
    sessionRunId?: SessionRunId | null;
  },
): Promise<DriverExecutionSpec> {
  const organizationPath = getOrganizationPath(input.profile);
  const actionUrlContext: RuntimeActionUrlContext = {
    bindings,
    driverInstanceId: input.driverInstanceId,
    requestUrl: input.requestUrl,
  };
  const [mcpServers, skills] = await Promise.all([
    Promise.all(
      input.resolvedMcpServers.map(async (server) => withRuntimeMcpProxy(actionUrlContext, server)),
    ),
    Promise.all(
      input.resolvedSkills.map(async (skill) => toRuntimeResolvedSkill(actionUrlContext, skill)),
    ),
  ]);

  return {
    configRevision: {
      ...input.profile.configRevision,
      runId: input.sessionRunId ?? null,
    },
    environment: {
      variables: { ...input.profile.envVars },
    },
    model: input.profile.model,
    profilePrompt: appendRuntimeArtifactContextToPrompt(input.profile.prompt),
    provider: input.profile.provider,
    providerOptions: input.profile.providerOptions,
    session: {
      additionalDirectories: listAdditionalDirectories(input.profile, organizationPath),
      context: {
        sandboxSessionId: input.profile.session.sandboxSessionId,
        homePath: input.profile.session.homePath,
        origin: input.profile.session.origin,
        sandboxId: input.profile.sandbox.id,
        sandboxKind: input.profile.kind,
        sandboxSubjectId: input.profile.sandbox.subjectId,
        sandboxSubjectKind: input.profile.sandbox.subjectKind,
        sessionOrganizationPath: organizationPath,
      },
      cwd: organizationPath,
      mcpServers,
      nativeResumeRef: input.nativeResumeRef ?? null,
    },
    skillCatalog: input.resolvedSkillCatalog,
    skills,
  };
}
