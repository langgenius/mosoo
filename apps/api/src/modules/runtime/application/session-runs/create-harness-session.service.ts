import { createDefaultAgentBuiltInTools } from "@mosoo/contracts/agent";
import type { HarnessSlug } from "@mosoo/contracts/harness";
import type { SessionSummary } from "@mosoo/contracts/session";
import { environmentsTable, sessionExecutionSnapshotsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId, isPlatformId, parsePlatformId } from "@mosoo/id";
import type { AccountId, EnvironmentId, AppId, SessionId } from "@mosoo/id";
import {
  getHarnessCatalogEntry,
  getHarnessProfileVersion,
  getRuntimeCatalogEntry,
} from "@mosoo/runtime-catalog";
import { and, eq } from "drizzle-orm";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase, runAppDatabaseBatch } from "../../../../platform/db/drizzle";
import { validationError } from "../../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../../time";
import {
  computeAgentReadiness,
  formatAgentReadinessFailureMessage,
} from "../../../agents/application/agent-readiness.service";
import { ensureAppOwnership } from "../../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import { ensureEnvironmentAccess } from "../../../environments/application/environment-access.service";
import { getAppDefaultEnvironmentId } from "../../../environments/application/environment-defaults";
import { resolveReadyEnvironmentPackageArtifact } from "../../../environments/application/environment-package-artifact.service";
import type { EnvironmentRecordRow } from "../../../environments/application/environment-types";
import { toHarnessDriverCompatibilityAgentId } from "../harness-driver-compatibility";
import type { SessionExecutionPlan } from "../session-definition/session-execution.types";

export interface CreateHarnessSessionRequest {
  bindings: ApiBindings;
  environment?: string | undefined;
  harness: HarnessSlug;
  model?: string | undefined;
  profile?: string | undefined;
  viewer: AuthenticatedViewer;
  workspaceId: AppId;
}

async function resolveEnvironmentId(
  database: D1Database,
  input: { environment?: string | undefined; workspaceId: AppId },
): Promise<EnvironmentId> {
  const reference = input.environment?.trim();

  if (reference === undefined || reference === "" || reference === "mosoo/general") {
    return getAppDefaultEnvironmentId(database, input.workspaceId);
  }

  if (isPlatformId(reference.toUpperCase())) {
    return parsePlatformId<EnvironmentId>(reference, "Environment ID");
  }

  const row =
    (await getAppDatabase(database)
      .select({ id: environmentsTable.id })
      .from(environmentsTable)
      .where(
        and(eq(environmentsTable.appId, input.workspaceId), eq(environmentsTable.name, reference)),
      )
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw validationError(`Environment ${reference} was not found in this Workspace.`);
  }

  return row.id;
}

function buildExecutionPlan(input: {
  environment: EnvironmentRecordRow;
  harness: NonNullable<ReturnType<typeof getHarnessCatalogEntry>>;
  model: string;
  profile: NonNullable<ReturnType<typeof getHarnessProfileVersion>>;
  sessionId: SessionId;
}): SessionExecutionPlan {
  const runtime = getRuntimeCatalogEntry(input.profile.runtimeId);

  if (runtime === null) {
    throw new Error(`Harness profile runtime ${input.profile.runtimeId} is unavailable.`);
  }

  return {
    binding: {
      agentId: toHarnessDriverCompatibilityAgentId(input.sessionId),
      deploymentVersionId: null,
      deploymentVersionNumber: null,
      kind: "cattle",
      model: input.model,
      prompt: "",
      provider: runtime.defaultProvider,
      runtimeId: runtime.runtimeId,
    },
    builtInTools: createDefaultAgentBuiltInTools(),
    environment: {
      allowMcpServers: input.environment.allowMcpServers === 1,
      allowPackageManagers: input.environment.allowPackageManagers === 1,
      allowedHostsJson: input.environment.allowedHostsJson,
      envVarsJson: input.environment.envVarsJson,
      environmentId: input.environment.id,
      environmentName: input.environment.name,
      networkPolicy: input.environment.networkPolicy,
      packagesJson: input.environment.packagesJson,
      revisionId: input.environment.currentRevisionId,
      setupScript: input.environment.setupScript,
    },
    skills: [],
    source: {
      harness: input.harness.slug,
      kind: "harness",
      profile: {
        id: input.profile.id,
        revision: input.profile.provenance.revision,
        version: input.profile.version,
      },
      version: input.harness.version,
    },
    tools: [],
  };
}

export async function createHarnessSession(
  request: CreateHarnessSessionRequest,
): Promise<SessionSummary> {
  const workspaceId = parsePlatformId<AppId>(request.workspaceId, "Workspace ID");
  const viewerId = parsePlatformId<AccountId>(request.viewer.id, "viewer ID");
  const workspace = await ensureAppOwnership(request.bindings.DB, viewerId, workspaceId);
  const harness = getHarnessCatalogEntry(request.harness);

  if (harness === null || harness.status !== "available") {
    throw validationError(`Harness ${request.harness} is unavailable.`);
  }

  const profile = getHarnessProfileVersion(harness.slug, request.profile?.trim());
  if (profile === null || profile.status !== "available") {
    throw validationError(
      `Harness profile ${request.profile ?? harness.defaultProfile} is unavailable.`,
    );
  }

  const model = request.model?.trim() || profile.defaultModel;
  if (!harness.supportedModels.includes(model)) {
    throw validationError(`Model ${model} is not supported by Harness ${harness.slug}.`);
  }

  const environmentId = await resolveEnvironmentId(request.bindings.DB, {
    environment: request.environment,
    workspaceId,
  });
  const environmentAccess = await ensureEnvironmentAccess(request.bindings.DB, viewerId, {
    environmentId,
    appId: workspaceId,
  });
  const sessionId = createPlatformId<SessionId>();
  const executionPlan = buildExecutionPlan({
    environment: environmentAccess.row,
    harness,
    model,
    profile,
    sessionId,
  });
  const readiness = await computeAgentReadiness(request.bindings.DB, workspace.ownerAccountId, {
    agentId: executionPlan.binding.agentId,
    bindings: request.bindings,
    environment: { environmentId },
    environmentNetworkPolicy: executionPlan.environment.networkPolicy,
    kind: "cattle",
    mcpServerIds: [],
    model,
    packageResolution: null,
    appId: workspaceId,
    provider: executionPlan.binding.provider,
    runtimeId: executionPlan.binding.runtimeId,
  });

  if (!readiness.ready) {
    throw validationError(
      formatAgentReadinessFailureMessage("Harness is not ready to run", readiness),
      "AGENT_SESSION_NOT_READY",
    );
  }

  await resolveReadyEnvironmentPackageArtifact(
    request.bindings,
    workspaceId,
    executionPlan.environment.packagesJson,
  );

  const timestampMs = currentTimestampMs();
  await runAppDatabaseBatch(request.bindings.DB, (database) => [
    database.insert(sessionsTable).values({
      agentId: executionPlan.binding.agentId,
      createdAt: timestampMs,
      creatorAccountId: viewerId,
      deploymentVersionId: null,
      deploymentVersionNumber: null,
      id: sessionId,
      kind: "cattle",
      metadataJson: JSON.stringify({ source: "run_api" }),
      model,
      appId: workspaceId,
      provider: executionPlan.binding.provider,
      participantAccountId: viewerId,
      renamed: false,
      runtimeId: executionPlan.binding.runtimeId,
      status: "IDLE",
      title: null,
      type: "api_channel",
      updatedAt: timestampMs,
    }),
    database.insert(sessionExecutionSnapshotsTable).values({
      createdAt: timestampMs,
      planJson: JSON.stringify(executionPlan),
      sessionId,
    }),
  ]);

  const timestamp = toIsoString(timestampMs);
  return {
    agentId: executionPlan.binding.agentId,
    archivedAt: null,
    createdAt: timestamp,
    deploymentVersionId: null,
    deploymentVersionNumber: null,
    id: sessionId,
    kind: "cattle",
    lastMessageAt: null,
    lastRun: null,
    model,
    appId: workspaceId,
    provider: executionPlan.binding.provider,
    runtimeId: executionPlan.binding.runtimeId,
    status: "IDLE",
    title: null,
    type: "api_channel",
    updatedAt: timestamp,
  };
}
