import type { PrimitiveRecord } from "@mosoo/contracts";
import type { AgentEnvironmentConfig } from "@mosoo/contracts/agent";
import type {
  CreateAgentSessionInput,
  SessionSummary,
  SessionType,
} from "@mosoo/contracts/session";
import { sessionExecutionSnapshotsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId, parseNullablePlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, CredentialId, AppId, SessionId } from "@mosoo/id";
import { getAvailableAgentSessionActionCapability } from "@mosoo/session-policy";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { runAppDatabaseBatch } from "../../../../platform/db/drizzle";
import { validationError } from "../../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../../time";
import { ensureAppAgentOwner } from "../../../agents/application/agent-access.service";
import {
  listAgentSkillReferences,
  listAgentToolReferences,
  requireAgentLiveDeploymentVersionRecord,
  toVersionAgentEnvironmentConfig,
} from "../../../agents/application/agent-deployment-version.service";
import type { AgentDeploymentVersionRecord } from "../../../agents/application/agent-deployment-version.service";
import { loadAgentEnvironmentConfig } from "../../../agents/application/agent-environment.service";
import {
  computeAgentReadiness,
  formatAgentReadinessFailureMessage,
} from "../../../agents/application/agent-readiness.service";
import { parseAgentStoredConfig } from "../../../agents/application/agent-stored-config.service";
import type { AgentRow } from "../../../agents/application/agent-types";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { resolveReadyEnvironmentPackageArtifact } from "../../../environments/application/environment-package-artifact.service";
import { resolveAgentEnvironmentSnapshot } from "../../../environments/application/environment.service";
import type { SessionExecutionPlan } from "../session-definition/session-execution.types";

export interface CreateAgentSessionOptions {
  accessViewer?: AuthenticatedViewer;
  attributedUserId?: string | AccountId | null | undefined;
  metadata?: AgentSessionMetadata | null | undefined;
}

export interface ChannelSessionTriggeredByMetadata {
  binding_id: string;
  event_id: string;
  external_actor_id: string;
  external_message_id: string;
  external_thread_id: string;
  external_workspace_id: string;
  provider: string;
  provider_metadata: PrimitiveRecord;
}

export interface AgentSessionMetadata {
  public_api?: {
    client_external_ref: string | null;
    created_by: {
      id: string;
      kind: "access_token";
      token_id: string;
      token_label: string;
    };
    source: "public_api";
  };
  triggered_by?: ChannelSessionTriggeredByMetadata;
}

export interface CreateAgentSessionRequest {
  bindings: ApiBindings;
  executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
  input: CreateAgentSessionInput;
  options?: CreateAgentSessionOptions;
  requestUrl?: string;
  viewer: AuthenticatedViewer;
}

interface AgentSessionExecutionSource {
  agent: AgentRow;
  configJson: string;
  environment: AgentEnvironmentConfig;
  kind: AgentRow["kind"];
  liveVersion: AgentDeploymentVersionRecord | null;
  model: string;
  prompt: string;
  provider: string;
  runtimeId: string;
}

async function resolveAgentSessionExecutionSource(input: {
  accessViewer: AuthenticatedViewer;
  bindings: ApiBindings;
  agentId: AgentId;
  appId: AppId;
}): Promise<AgentSessionExecutionSource> {
  const accessViewerId = parsePlatformId<AccountId>(input.accessViewer.id, "access viewer id");
  const { agent } = await ensureAppAgentOwner(input.bindings.DB, accessViewerId, {
    agentId: input.agentId,
    appId: input.appId,
  });
  const liveVersion =
    agent.status === "published"
      ? await requireAgentLiveDeploymentVersionRecord(input.bindings.DB, agent)
      : null;
  const environment = liveVersion
    ? toVersionAgentEnvironmentConfig(liveVersion)
    : await loadAgentEnvironmentConfig(input.bindings.DB, agent.id, agent.environmentId);

  return {
    agent,
    configJson: liveVersion?.configJson ?? agent.configJson,
    environment,
    liveVersion,
    kind: liveVersion?.kind ?? agent.kind,
    model: liveVersion?.model ?? agent.model,
    prompt: liveVersion?.prompt ?? agent.prompt,
    provider: liveVersion?.provider ?? agent.provider,
    runtimeId: liveVersion?.runtimeId ?? agent.runtimeId,
  };
}

async function ensureAgentReadyToCreateSession(input: {
  bindings: ApiBindings;
  source: AgentSessionExecutionSource;
}): Promise<void> {
  getAvailableAgentSessionActionCapability({
    action: "create_session",
    runtimeId: input.source.runtimeId,
  });

  const readiness = await computeAgentReadiness(input.bindings.DB, input.source.agent.ownerId, {
    agentId: input.source.agent.id,
    bindings: input.bindings,
    environment: input.source.environment,
    model: input.source.model,
    packageResolution: parseAgentStoredConfig(input.source.configJson).packageResolution,
    appId: input.source.agent.appId,
    provider: input.source.provider,
    runtimeId: input.source.runtimeId,
  });

  if (!readiness.ready) {
    throw validationError(
      formatAgentReadinessFailureMessage("Agent is not ready to run", readiness),
      "AGENT_SESSION_NOT_READY",
    );
  }
}

async function buildSessionExecutionPlan(input: {
  bindings: ApiBindings;
  source: AgentSessionExecutionSource;
}): Promise<SessionExecutionPlan> {
  const storedConfig = parseAgentStoredConfig(
    input.source.liveVersion?.configJson ?? input.source.agent.configJson,
  );
  const [skills, tools, environmentSnapshot] = await Promise.all([
    input.source.liveVersion
      ? Promise.resolve(input.source.liveVersion.skills)
      : listAgentSkillReferences(input.bindings.DB, input.source.agent.id),
    input.source.liveVersion
      ? Promise.resolve(
          input.source.liveVersion.mcpBindings
            .filter((binding) => binding.enabled)
            .toSorted((left, right) => left.sortOrder - right.sortOrder)
            .map((binding) => ({
              agentCredentialId: parseNullablePlatformId<CredentialId>(
                binding.agentCredentialId,
                "agent credential id",
              ),
              credentialMode: binding.credentialMode,
              serverId: binding.serverId,
              sortOrder: binding.sortOrder,
            })),
        )
      : listAgentToolReferences(input.bindings.DB, input.source.agent.id),
    resolveAgentEnvironmentSnapshot(input.bindings, {
      agentEnvironmentId: input.source.environment.environmentId,
      agentOwnerId: input.source.agent.ownerId,
      appId: input.source.agent.appId,
    }),
  ]);

  return {
    binding: {
      agentId: input.source.agent.id,
      deploymentVersionId: input.source.liveVersion?.id ?? null,
      deploymentVersionNumber: input.source.liveVersion?.versionNumber ?? null,
      kind: input.source.kind,
      model: input.source.model,
      prompt: input.source.prompt,
      provider: input.source.provider,
      runtimeId: input.source.runtimeId,
    },
    builtInTools: storedConfig.builtInTools,
    environment: {
      allowMcpServers: environmentSnapshot.record.allowMcpServers === 1,
      allowPackageManagers: environmentSnapshot.record.allowPackageManagers === 1,
      allowedHostsJson: environmentSnapshot.record.allowedHostsJson,
      envVarsJson: environmentSnapshot.record.envVarsJson,
      environmentId: environmentSnapshot.record.id,
      environmentName: environmentSnapshot.name,
      networkPolicy: environmentSnapshot.record.networkPolicy,
      packagesJson: environmentSnapshot.record.packagesJson,
      revisionId: environmentSnapshot.record.currentRevisionId,
      setupScript: environmentSnapshot.setupScript,
    },
    skills,
    tools,
  };
}

async function insertAgentSessionSnapshot(input: {
  bindings: ApiBindings;
  executionPlan: SessionExecutionPlan;
  sessionId: SessionId;
  source: AgentSessionExecutionSource;
  timestampMs: number;
  type: SessionType;
  attributedUserId: AccountId | null;
  metadata: AgentSessionMetadata | null;
  viewer: AuthenticatedViewer;
}): Promise<void> {
  const viewerId: AccountId = parsePlatformId(input.viewer.id, "viewer id");

  await runAppDatabaseBatch(input.bindings.DB, (database) => [
    database.insert(sessionsTable).values({
      agentId: input.source.agent.id,
      attributedUserId: input.attributedUserId,
      createdAt: input.timestampMs,
      creatorAccountId: viewerId,
      deploymentVersionId: input.source.liveVersion?.id ?? null,
      deploymentVersionNumber: input.source.liveVersion?.versionNumber ?? null,
      id: input.sessionId,
      kind: input.source.kind,
      metadataJson: JSON.stringify(input.metadata ?? {}),
      model: input.source.model,
      appId: input.source.agent.appId,
      provider: input.source.provider,
      renamed: false,
      runtimeId: input.source.runtimeId,
      status: "IDLE",
      title: null,
      type: input.type,
      updatedAt: input.timestampMs,
    }),
    database.insert(sessionExecutionSnapshotsTable).values({
      createdAt: input.timestampMs,
      planJson: JSON.stringify(input.executionPlan),
      sessionId: input.sessionId,
    }),
  ]);
}

function buildCreatedSessionSummary(input: {
  sessionId: SessionId;
  source: AgentSessionExecutionSource;
  timestampMs: number;
  type: SessionType;
}): SessionSummary {
  const timestamp = toIsoString(input.timestampMs);

  return {
    agentId: input.source.agent.id,
    archivedAt: null,
    createdAt: timestamp,
    deploymentVersionId: input.source.liveVersion?.id ?? null,
    deploymentVersionNumber: input.source.liveVersion?.versionNumber ?? null,
    id: input.sessionId,
    kind: input.source.kind,
    lastMessageAt: null,
    lastRun: null,
    model: input.source.model,
    appId: input.source.agent.appId,
    provider: input.source.provider,
    runtimeId: input.source.runtimeId,
    status: "IDLE",
    title: null,
    type: input.type,
    updatedAt: timestamp,
  };
}

export async function createAgentSession(
  request: CreateAgentSessionRequest,
): Promise<SessionSummary> {
  const options = request.options ?? {};
  const accessViewer = options.accessViewer ?? request.viewer;
  const agentId = parsePlatformId<AgentId>(request.input.agentId, "agent id");
  const appId = parsePlatformId<AppId>(request.input.appId, "app id");
  const source = await resolveAgentSessionExecutionSource({
    accessViewer,
    agentId,
    bindings: request.bindings,
    appId,
  });
  await ensureAgentReadyToCreateSession({
    bindings: request.bindings,
    source,
  });

  const executionPlan = await buildSessionExecutionPlan({
    bindings: request.bindings,
    source,
  });
  await resolveReadyEnvironmentPackageArtifact(
    request.bindings,
    source.agent.appId,
    executionPlan.environment.packagesJson,
  );
  const sessionId = createPlatformId<SessionId>();
  const timestampMs = currentTimestampMs();
  const sessionType = request.input.type ?? "preview";

  if (request.input.waitForRuntimeReady === true && sessionType !== "preview") {
    throw validationError(
      "Runtime readiness wait is only supported for Preview session creation.",
      "RUNTIME_READY_WAIT_UNSUPPORTED",
    );
  }

  await insertAgentSessionSnapshot({
    bindings: request.bindings,
    executionPlan,
    sessionId,
    source,
    timestampMs,
    type: sessionType,
    attributedUserId: parseNullablePlatformId<AccountId>(
      options.attributedUserId,
      "attributed user id",
    ),
    metadata: options.metadata ?? null,
    viewer: request.viewer,
  });

  const session = buildCreatedSessionSummary({
    sessionId,
    source,
    timestampMs,
    type: sessionType,
  });

  if (request.requestUrl) {
    const { prewarmAgentSessionRuntime, scheduleAgentSessionRuntimePrewarm } =
      await import("./prewarm-agent-session-runtime.service");
    const prewarmRequest = {
      ...(options.accessViewer ? { accessViewer: options.accessViewer } : {}),
      bindings: request.bindings,
      requestUrl: request.requestUrl,
      session: {
        id: session.id,
        appId: session.appId,
      },
      viewer: request.viewer,
    };

    if (request.input.waitForRuntimeReady === true) {
      await prewarmAgentSessionRuntime({
        ...prewarmRequest,
        failureMode: "fail_fast",
      });
    } else {
      scheduleAgentSessionRuntimePrewarm({
        ...prewarmRequest,
        executionContext: request.executionContext ?? null,
      });
    }
  }

  return session;
}
