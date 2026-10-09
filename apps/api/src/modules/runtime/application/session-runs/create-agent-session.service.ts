import type { AgentEnvironmentConfig } from "@mosoo/contracts/agent";
import { admitModelId, admitProviderId, admitRuntimeId } from "@mosoo/contracts/models";
import type {
  CreateAgentSessionInput,
  SessionSummary,
  SessionType,
} from "@mosoo/contracts/session";
import { sessionExecutionSnapshotsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId, parseNullablePlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, CredentialId, ProjectId, SessionId } from "@mosoo/id";
import { resolveRuntimeModelProtocol } from "@mosoo/runtime-catalog";
import { getAgentSessionActionCapability } from "@mosoo/session-policy";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { runAppDatabaseBatch } from "../../../../platform/db/drizzle";
import { forbiddenError, validationError } from "../../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../../time";
import { ensureProjectAgentOwner } from "../../../agents/application/agent-access.service";
import {
  listAgentSkillReferences,
  listAgentToolReferences,
  requireAgentLiveDeploymentVersionRecord,
  toVersionAgentEnvironmentConfig,
} from "../../../agents/application/agent-deployment-version.service";
import type { AgentDeploymentVersionRecord } from "../../../agents/application/agent-deployment-version.service";
import {
  computeAgentReadiness,
  formatAgentReadinessFailureMessage,
} from "../../../agents/application/agent-readiness.service";
import { parseAgentStoredConfig } from "../../../agents/application/agent-stored-config.service";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { resolveReadyEnvironmentPackageArtifact } from "../../../environments/application/environment-package-artifact.service";
import { resolveAgentEnvironmentRecord } from "../../../environments/application/environment-runtime-snapshot";
import { ensureProjectOwnership } from "../../../projects/application/project.service";
import { PREVIEW_RETENTION_MS } from "../../../sessions/domain/preview-retention-policy";
import { resolveVendorCredentialRef } from "../../../vendor-credentials/application/vendor-credential.secret-resolution";
import type { SessionExecutionPlan } from "../session-definition/session-execution.types";

export interface CreateAgentSessionOptions {
  origin?: "console_preview";
  accessViewer?: AuthenticatedViewer;
  configurationSource?: "saved";
  endUserId?: string | null | undefined;
  metadata?: AgentSessionMetadata | null | undefined;
  sessionId?: SessionId | undefined;
}

export interface AgentSessionMetadata {
  public_api_initial_request_id?: string | null;
  public_api?: {
    api_version?: "v1" | "v2";
    created_by: {
      token_id: string;
      token_label: string;
    };
    idempotency_key: string | null;
    source: "public_api";
  };
}

export interface CreateAgentSessionRequest {
  bindings: ApiBindings;
  executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
  input: CreateAgentSessionInput;
  options?: CreateAgentSessionOptions;
  requestUrl?: string;
  viewer: AuthenticatedViewer;
}

export interface CreateProjectSessionRequest extends Omit<CreateAgentSessionRequest, "input"> {
  input: {
    projectId: ProjectId;
    runtimeId: string;
    provider: string;
    model: string;
    instructions: string;
  };
}

interface SessionCreationRequest extends Omit<CreateAgentSessionRequest, "input"> {
  input: Pick<CreateAgentSessionInput, "type">;
}

interface AgentSessionExecutionSource {
  agentId: AgentId | null;
  ownerId: AccountId;
  projectId: ProjectId;
  configJson: string;
  environment: AgentEnvironmentConfig;
  liveVersion: AgentDeploymentVersionRecord | null;
  model: string;
  prompt: string;
  provider: string;
  runtimeId: string;
}

async function resolveAgentSessionExecutionSource(input: {
  accessViewer: AuthenticatedViewer;
  configurationSource?: "saved" | undefined;
  bindings: ApiBindings;
  agentId: AgentId;
  projectId: ProjectId;
}): Promise<AgentSessionExecutionSource> {
  const accessViewerId = parsePlatformId<AccountId>(input.accessViewer.id, "access viewer id");
  const agent = await ensureProjectAgentOwner(input.bindings.DB, accessViewerId, {
    agentId: input.agentId,
    projectId: input.projectId,
  });
  const liveVersion =
    agent.status === "published" && input.configurationSource !== "saved"
      ? await requireAgentLiveDeploymentVersionRecord(input.bindings.DB, agent)
      : null;
  const environment = liveVersion
    ? toVersionAgentEnvironmentConfig(liveVersion)
    : { environmentId: agent.environmentId };

  return {
    agentId: agent.id,
    ownerId: agent.ownerId,
    projectId: agent.projectId,
    configJson: liveVersion?.configJson ?? agent.configJson,
    environment,
    liveVersion,
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
  const capability = getAgentSessionActionCapability({
    action: "create_session",
    runtimeId: input.source.runtimeId,
  });
  if (capability.status === "unavailable") {
    throw validationError(
      capability.reason ?? "This harness cannot create a Session.",
      "AGENT_SESSION_NOT_READY",
    );
  }

  const storedConfig = parseAgentStoredConfig(input.source.configJson);
  const readiness = await computeAgentReadiness(input.bindings.DB, {
    agentId: input.source.agentId,
    builtInTools: storedConfig.builtInTools,
    environment: input.source.environment,
    model: input.source.model,
    packageResolution: storedConfig.packageResolution,
    projectId: input.source.projectId,
    provider: input.source.provider,
    runtimeId: input.source.runtimeId,
  });

  if (!readiness.ready) {
    throw validationError(
      formatAgentReadinessFailureMessage(
        input.source.agentId === null ? "Session is not ready to run" : "Agent is not ready to run",
        readiness,
      ),
      "AGENT_SESSION_NOT_READY",
    );
  }
}

async function buildSessionExecutionPlan(input: {
  bindings: ApiBindings;
  source: AgentSessionExecutionSource;
}): Promise<SessionExecutionPlan> {
  const storedConfig = parseAgentStoredConfig(input.source.configJson);
  const credential = await resolveVendorCredentialRef({
    bindings: input.bindings,
    options: { modelId: input.source.model },
    projectId: input.source.projectId,
    vendorId: input.source.provider,
  });
  if (credential === null) {
    throw validationError(
      `No credential available for ${input.source.provider}. Configure in Providers.`,
      "AGENT_SESSION_NOT_READY",
    );
  }
  const protocol = resolveRuntimeModelProtocol({
    runtimeId: input.source.runtimeId,
    vendorId: credential.vendorId,
    modelId: input.source.model,
    customModelProtocol: credential.modelProtocol ?? null,
  });
  if (!protocol.ok) {
    throw validationError(protocol.message, "AGENT_SESSION_NOT_READY");
  }
  const [skills, tools, environment] = await Promise.all([
    input.source.liveVersion
      ? Promise.resolve(input.source.liveVersion.skills)
      : input.source.agentId === null
        ? Promise.resolve([])
        : listAgentSkillReferences(input.bindings.DB, input.source.agentId),
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
      : input.source.agentId === null
        ? Promise.resolve([])
        : listAgentToolReferences(input.bindings.DB, input.source.agentId),
    resolveAgentEnvironmentRecord(input.bindings.DB, {
      agentEnvironmentId: input.source.environment.environmentId,
      agentOwnerId: input.source.ownerId,
      projectId: input.source.projectId,
    }),
  ]);

  return {
    binding: {
      agentId: input.source.agentId,
      deploymentVersionId: input.source.liveVersion?.id ?? null,
      deploymentVersionNumber: input.source.liveVersion?.versionNumber ?? null,
      model: input.source.model,
      prompt: input.source.prompt,
      provider: input.source.provider,
      runtimeId: input.source.runtimeId,
    },
    builtInTools: storedConfig.builtInTools,
    configJson: input.source.configJson,
    modelProtocol: protocol.modelProtocol,
    environment: {
      allowedHostsJson: environment.allowedHostsJson,
      envVarsJson: environment.envVarsJson,
      environmentId: environment.id,
      environmentName: environment.name,
      networkPolicy: environment.networkPolicy,
      packagesJson: environment.packagesJson,
      revisionId: environment.currentRevisionId,
      setupScript: environment.setupScript,
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
  endUserId: string | null;
  metadata: AgentSessionMetadata | null;
  viewer: AuthenticatedViewer;
}): Promise<void> {
  const viewerId: AccountId = parsePlatformId(input.viewer.id, "viewer id");

  await runAppDatabaseBatch(input.bindings.DB, (database) => [
    database.insert(sessionsTable).values({
      agentId: input.source.agentId,
      createdAt: input.timestampMs,
      creatorAccountId: viewerId,
      deploymentVersionId: input.source.liveVersion?.id ?? null,
      deploymentVersionNumber: input.source.liveVersion?.versionNumber ?? null,
      id: input.sessionId,
      kind: "cattle",
      ...(input.endUserId === null ? {} : { endUserId: input.endUserId }),
      metadataJson: JSON.stringify(input.metadata ?? {}),
      model: input.source.model,
      projectId: input.source.projectId,
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
    agentId: input.source.agentId,
    archivedAt: null,
    createdAt: timestamp,
    deploymentVersionId: input.source.liveVersion?.id ?? null,
    deploymentVersionNumber: input.source.liveVersion?.versionNumber ?? null,
    id: input.sessionId,
    lastMessageAt: null,
    lastRun: null,
    model: input.source.model,
    projectId: input.source.projectId,
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
  const projectId = parsePlatformId<ProjectId>(request.input.projectId, "project id");
  const source = await resolveAgentSessionExecutionSource({
    accessViewer,
    configurationSource: options.configurationSource,
    agentId,
    bindings: request.bindings,
    projectId,
  });
  return createSessionFromSource(request, source);
}

export async function createProjectSession(
  request: CreateProjectSessionRequest,
): Promise<SessionSummary> {
  const accessViewer = request.options?.accessViewer ?? request.viewer;
  const projectId = parsePlatformId<ProjectId>(request.input.projectId, "project id");
  for (const viewer of [request.viewer, accessViewer]) {
    if (viewer.projectId !== undefined && viewer.projectId !== projectId) {
      throw forbiddenError();
    }
  }
  const project = await ensureProjectOwnership(request.bindings.DB, accessViewer.id, projectId);
  return createSessionFromSource(
    { ...request, input: { type: "ui" } },
    {
      model: admitModelId(request.input.model),
      provider: admitProviderId(request.input.provider),
      runtimeId: admitRuntimeId(request.input.runtimeId),
      agentId: null,
      ownerId: project.ownerAccountId,
      projectId,
      configJson: "{}",
      environment: { environmentId: null },
      liveVersion: null,
      prompt: request.input.instructions,
    },
  );
}

async function createSessionFromSource(
  request: SessionCreationRequest,
  source: AgentSessionExecutionSource,
): Promise<SessionSummary> {
  const options = request.options ?? {};
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
    source.projectId,
    executionPlan.environment.packagesJson,
  );
  const sessionId = options.sessionId ?? createPlatformId<SessionId>();
  const timestampMs = currentTimestampMs();
  const sessionType = request.input.type ?? "preview";
  if (
    options.origin === "console_preview" &&
    sessionType === "preview" &&
    request.viewer.apiKeyId === undefined
  ) {
    executionPlan.previewRetentionMs = PREVIEW_RETENTION_MS;
  }

  await insertAgentSessionSnapshot({
    bindings: request.bindings,
    executionPlan,
    sessionId,
    source,
    timestampMs,
    type: sessionType,
    endUserId: options.endUserId ?? null,
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
    const { scheduleAgentSessionRuntimePrewarm } =
      await import("./prewarm-agent-session-runtime.service");
    scheduleAgentSessionRuntimePrewarm({
      ...(options.accessViewer ? { accessViewer: options.accessViewer } : {}),
      bindings: request.bindings,
      executionContext: request.executionContext ?? null,
      requestUrl: request.requestUrl,
      session: {
        id: session.id,
        projectId: session.projectId,
      },
      viewer: request.viewer,
    });
  }

  return session;
}
