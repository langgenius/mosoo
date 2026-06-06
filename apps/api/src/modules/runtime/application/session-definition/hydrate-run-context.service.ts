import type { SessionSummary } from "@mosoo/contracts/session";
import type { UserWarning } from "@mosoo/contracts/session-run";
import type { ResolvedRunSkill } from "@mosoo/contracts/skill";
import { getSessionOrganizationPath } from "@mosoo/driver-protocol";
import type {
  DriverProfileConfig,
  DriverRuntime,
  DriverSkillCatalogEntry,
} from "@mosoo/driver-protocol";
import { createPlatformId } from "@mosoo/id";
import type { AgentId, PlatformId, SandboxId, SandboxSessionId, SessionId } from "@mosoo/id";
import { getRuntimeCatalogEntry, getRuntimeCatalogVendorForProvider } from "@mosoo/runtime-catalog";
import type { RuntimeCatalogVendor } from "@mosoo/runtime-catalog";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { validationError } from "../../../../platform/errors";
import { isTruthy } from "../../../../shared/truthiness";
import { ensureAgentAccess } from "../../../agents/application/agent-access.service";
import { getAgentDeploymentVersionRecord } from "../../../agents/application/agent-deployment-version.service";
import {
  computeAgentReadiness,
  formatAgentReadinessFailureMessage,
} from "../../../agents/application/agent-readiness.service";
import { parseAgentStoredConfig } from "../../../agents/application/agent-stored-config.service";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import {
  decryptEnvironmentVariables,
  parseStoredEnvVarsJson,
} from "../../../environments/application/environment-config";
import { resolveRuntimeMcpServersForSnapshot } from "../../../mcp/application/mcp-runtime.service";
import { resolveVendorApiKey } from "../../../vendor-credentials/application/vendor-credential.service";
import type { ResolvedVendorCredential } from "../../../vendor-credentials/application/vendor-credential.types";
import { getSupportedRuntimeId } from "../../domain/runtime-config";
import { resolveAgentRuntimeSandboxSubject } from "../../domain/runtime-sandbox-subject";
import {
  ensureRuntimeSubjectId,
  getRuntimeConversationSession,
} from "../../infrastructure/runtime-subject-lifecycle/runtime-subject-store";
import { createAgentRuntimeProfile, resolveAgentSpaceBindings } from "../agent-runtime-profile";
import {
  appendRuntimeDiagnosticEvent,
  toRuntimeDiagnosticBaseValue,
  toRuntimeDiagnosticReason,
} from "../runtime-diagnostic-events";
import { getSessionExecutionPlan } from "./session-execution.repository";
import type { HydratedSessionRunContext } from "./session-execution.types";
import { resolveSessionSkillReferences } from "./session-skill-reference-resolution.service";
import {
  buildSnapshotAgentEnvironment,
  mergeSessionSnapshotEnvVars,
} from "./session-snapshot-hydration";

interface HydratedRunContextCacheEntry {
  expiresAtMs: number;
  value: HydratedSessionRunContext;
}

interface RuntimeVendorEnvironmentInput {
  credential: ResolvedVendorCredential;
  model: DriverProfileConfig["model"];
  runtimeId: DriverRuntime;
  vendor: RuntimeCatalogVendor;
}

const HYDRATED_RUN_CONTEXT_CACHE_TTL_MS = 20_000;
const hydratedRunContextCache = new Map<string, HydratedRunContextCacheEntry>();

async function resolveRuntimeProfileIds(
  bindings: ApiBindings,
  input: {
    agentId: AgentId;
    kind: DriverProfileConfig["kind"];
    sessionId: SessionId;
  },
): Promise<{
  cloudflareSessionId: SandboxSessionId;
  sandboxId: SandboxId;
}> {
  const sandboxSubject = resolveAgentRuntimeSandboxSubject(input);
  const [sandboxId, existingConversationSession] = await Promise.all([
    ensureRuntimeSubjectId(bindings.DB, sandboxSubject),
    getRuntimeConversationSession(bindings.DB, input.sessionId),
  ]);

  return {
    cloudflareSessionId:
      existingConversationSession?.cloudflareSessionId ?? createPlatformId<SandboxSessionId>(),
    sandboxId,
  };
}

function getHydratedRunContextCacheKey(input: {
  accessViewerId?: PlatformId;
  sessionId: SessionId;
  viewerId: PlatformId;
}): string {
  return [input.sessionId, input.viewerId, input.accessViewerId ?? input.viewerId].join(":");
}

function readHydratedRunContextCache(
  cacheKey: string,
  nowMs: number,
): HydratedSessionRunContext | null {
  const entry = hydratedRunContextCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (entry.expiresAtMs <= nowMs) {
    hydratedRunContextCache.delete(cacheKey);
    return null;
  }

  return entry.value;
}

function writeHydratedRunContextCache(
  cacheKey: string,
  value: HydratedSessionRunContext,
  nowMs: number,
): void {
  hydratedRunContextCache.set(cacheKey, {
    expiresAtMs: nowMs + HYDRATED_RUN_CONTEXT_CACHE_TTL_MS,
    value: sanitizeHydratedRunContextForCache(value),
  });
}

function sanitizeHydratedRunContextForCache(
  value: HydratedSessionRunContext,
): HydratedSessionRunContext {
  return {
    ...value,
    mcpServers: [],
    profile: {
      ...value.profile,
      envVarNames: [],
      envVars: {},
    },
  };
}

function buildRuntimeVendorEnvVars(input: RuntimeVendorEnvironmentInput): Record<string, string> {
  const envVars: Record<string, string> = {
    [input.vendor.apiKeyEnvVar]: input.credential.apiKey,
  };

  if (isTruthy(input.credential.apiBase)) {
    if (!isTruthy(input.vendor.apiBaseEnvVar)) {
      throw new Error(
        `${input.vendor.label} does not support a custom API base URL for the configured runtime. Remove the apiBase override from the credential or pick a vendor that supports it.`,
      );
    }

    envVars[input.vendor.apiBaseEnvVar] = input.credential.apiBase;
  }

  return envVars;
}

async function hydrateRunContextFromSession(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  session: Pick<SessionSummary, "id" | "organizationId"> & {
    accessViewer?: AuthenticatedViewer;
  },
): Promise<HydratedSessionRunContext> {
  const executionPlan = await getSessionExecutionPlan(bindings.DB, session.id);
  const binding = {
    ...executionPlan.binding,
    sessionId: session.id,
  };
  const skillReferences = executionPlan.skills.toSorted(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  const warnings: UserWarning[] = [];
  const skillCatalog: DriverSkillCatalogEntry[] = [];
  const skills: Omit<ResolvedRunSkill, "downloadUrl">[] = [];
  const runtimeId = getSupportedRuntimeId(binding.runtimeId);

  if (runtimeId === null) {
    throw new Error(`Unsupported runtime: ${binding.runtimeId}.`);
  }

  const [agent, deploymentVersion] = await Promise.all([
    ensureAgentAccess(bindings.DB, session.accessViewer?.id ?? viewer.id, binding.agentId),
    isTruthy(binding.deploymentVersionId)
      ? getAgentDeploymentVersionRecord(bindings.DB, binding.deploymentVersionId)
      : Promise.resolve(null),
  ]);
  const storedConfig = parseAgentStoredConfig(deploymentVersion?.configJson ?? agent.configJson);
  const environmentSnapshot = executionPlan.environment;
  const toolReferences = executionPlan.tools.toSorted(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  const spaceReferences = executionPlan.spaces.toSorted(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  const snapshotEnvironment = buildSnapshotAgentEnvironment({
    boundSpaceIds: spaceReferences.map((reference) => reference.spaceId),
    environmentId: environmentSnapshot.environmentId,
  });
  const [agentReadiness, agentMounts] = await Promise.all([
    computeAgentReadiness(bindings.DB, agent.ownerId, {
      agentId: agent.id,
      bindings,
      environment: snapshotEnvironment,
      mcpServerIds: toolReferences.map((reference) => reference.serverId),
      model: binding.model,
      organizationId: agent.organizationId,
      packageResolution: storedConfig.packageResolution,
      provider: binding.provider,
      runtimeId,
    }),
    resolveAgentSpaceBindings(bindings.DB, agent.ownerId, snapshotEnvironment.boundSpaceIds),
  ]);

  if (!agentReadiness.ready) {
    throw validationError(
      formatAgentReadinessFailureMessage("Agent is not ready to run", agentReadiness),
      "AGENT_SESSION_NOT_READY",
    );
  }

  const skillMountRoot = `${getSessionOrganizationPath(session.id)}/.mosoo/skill`;

  const resolvedSkillReferences = await resolveSessionSkillReferences({
    database: bindings.DB,
    sessionOrganizationId: session.organizationId,
    skillMountRoot,
    skillReferences,
  });

  for (const resolvedSkillReference of resolvedSkillReferences) {
    skillCatalog.push(resolvedSkillReference.skillCatalogEntry);
    skills.push(resolvedSkillReference.skill);
    warnings.push(...resolvedSkillReference.warnings);
  }

  const catalogEntry = getRuntimeCatalogEntry(runtimeId);

  if (catalogEntry === null) {
    throw new Error(`Unsupported runtime: ${runtimeId}.`);
  }

  const vendor = getRuntimeCatalogVendorForProvider(catalogEntry, binding.provider);

  if (!vendor) {
    throw new Error(`Runtime ${binding.runtimeId} does not declare vendor ${binding.provider}.`);
  }

  const [credential, snapshotEnvVars] = await Promise.all([
    resolveVendorApiKey({
      actorAccountId: agent.ownerId,
      bindings,
      options: { modelId: binding.model },
      organizationId: session.organizationId,
      vendorId: vendor.vendorId,
    }),
    decryptEnvironmentVariables(bindings, {
      environmentId: environmentSnapshot.environmentId,
      envVars: parseStoredEnvVarsJson(environmentSnapshot.envVarsJson),
    }),
  ]);

  if (!credential) {
    await appendRuntimeDiagnosticEvent(bindings, {
      eventName: RUNTIME_DIAGNOSTIC_EVENT.configCredentialMissing.name,
      sessionId: session.id,
      value: {
        ...toRuntimeDiagnosticBaseValue({
          agentId: agent.id,
          sessionId: session.id,
        }),
        provider: binding.provider,
        reason: "no_active_key",
      },
    });
    throw new Error(`No credential available for ${vendor.label}. Configure in Providers.`);
  }

  const vendorEnvVars = buildRuntimeVendorEnvVars({
    credential,
    model: binding.model,
    runtimeId,
    vendor,
  });

  const envVars = mergeSessionSnapshotEnvVars({
    snapshotEnvVars,
    vendorEnvVars,
  });
  let runtimeProfileResult: ReturnType<typeof createAgentRuntimeProfile>;
  const runtimeProfileIds = await resolveRuntimeProfileIds(bindings, {
    agentId: agent.id,
    kind: binding.kind,
    sessionId: session.id,
  });

  try {
    runtimeProfileResult = createAgentRuntimeProfile({
      agentId: agent.id,
      cloudflareSessionId: runtimeProfileIds.cloudflareSessionId,
      callerUserId: viewer.id,
      configRevision: {
        agentId: binding.agentId,
        deploymentVersionId: binding.deploymentVersionId,
        deploymentVersionNumber: binding.deploymentVersionNumber,
        environmentId: environmentSnapshot.environmentId,
        environmentRevisionId: environmentSnapshot.revisionId,
        runId: null,
        sessionId: session.id,
      },
      envVars,
      executionOwnerUserId: agent.ownerId,
      kind: binding.kind,
      model: binding.model,
      prompt: binding.prompt,
      provider: binding.provider,
      readiness: agentReadiness,
      runtimeId,
      sandboxId: runtimeProfileIds.sandboxId,
      sessionId: session.id,
      setupScript: environmentSnapshot.setupScript,
      spaceBindings: agentMounts,
    });
  } catch (error) {
    await appendRuntimeDiagnosticEvent(bindings, {
      eventName: RUNTIME_DIAGNOSTIC_EVENT.configManifestRenderFailed.name,
      sessionId: session.id,
      value: {
        ...toRuntimeDiagnosticBaseValue({
          agentId: agent.id,
          sessionId: session.id,
        }),
        fieldPath: "runtimeProfile",
        reason: toRuntimeDiagnosticReason(error, "Runtime manifest render failed."),
      },
    });
    throw error;
  }
  const { profile } = runtimeProfileResult;

  const mcpServers = await resolveRuntimeMcpServersForSnapshot(bindings, {
    agentId: agent.id,
    bindings: toolReferences.map((reference) => ({
      agentCredentialId: reference.agentCredentialId,
      credentialMode: reference.credentialMode,
      enabled: true,
      serverId: reference.serverId,
      sortOrder: reference.sortOrder,
    })),
    callerUserId: viewer.id,
    executionOwnerUserId: agent.ownerId,
  });

  return {
    mcpServers,
    organizationAccessSnapshot: runtimeProfileResult.organizationAccessSnapshot,
    profile,
    skillCatalog,
    skills,
    warnings,
  };
}

async function refreshCachedRunContextVolatileFields(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  session: Pick<SessionSummary, "id" | "organizationId"> & {
    accessViewer?: AuthenticatedViewer;
  },
  cached: HydratedSessionRunContext,
): Promise<HydratedSessionRunContext> {
  const executionPlan = await getSessionExecutionPlan(bindings.DB, session.id);
  const binding = {
    ...executionPlan.binding,
    sessionId: session.id,
  };
  const runtimeId = getSupportedRuntimeId(binding.runtimeId);

  if (runtimeId === null) {
    throw new Error(`Unsupported runtime: ${binding.runtimeId}.`);
  }

  const agent = await ensureAgentAccess(
    bindings.DB,
    session.accessViewer?.id ?? viewer.id,
    binding.agentId,
  );
  const catalogEntry = getRuntimeCatalogEntry(runtimeId);

  if (catalogEntry === null) {
    throw new Error(`Unsupported runtime: ${runtimeId}.`);
  }

  const vendor = getRuntimeCatalogVendorForProvider(catalogEntry, binding.provider);

  if (!vendor) {
    throw new Error(`Runtime ${binding.runtimeId} does not declare vendor ${binding.provider}.`);
  }

  const environmentSnapshot = executionPlan.environment;
  const spaceReferences = executionPlan.spaces.toSorted(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  const toolReferences = executionPlan.tools.toSorted(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  const [credential, snapshotEnvVars, agentMounts, mcpServers] = await Promise.all([
    resolveVendorApiKey({
      actorAccountId: agent.ownerId,
      bindings,
      options: { modelId: binding.model },
      organizationId: session.organizationId,
      vendorId: vendor.vendorId,
    }),
    decryptEnvironmentVariables(bindings, {
      environmentId: environmentSnapshot.environmentId,
      envVars: parseStoredEnvVarsJson(environmentSnapshot.envVarsJson),
    }),
    resolveAgentSpaceBindings(
      bindings.DB,
      agent.ownerId,
      spaceReferences.map((reference) => reference.spaceId),
    ),
    toolReferences.length > 0
      ? resolveRuntimeMcpServersForSnapshot(bindings, {
          agentId: agent.id,
          bindings: toolReferences.map((reference) => ({
            agentCredentialId: reference.agentCredentialId,
            credentialMode: reference.credentialMode,
            enabled: true,
            serverId: reference.serverId,
            sortOrder: reference.sortOrder,
          })),
          callerUserId: viewer.id,
          executionOwnerUserId: agent.ownerId,
        })
      : Promise.resolve([]),
  ]);

  if (!credential) {
    throw new Error(`No credential available for ${vendor.label}. Configure in Providers.`);
  }

  const envVars = mergeSessionSnapshotEnvVars({
    snapshotEnvVars,
    vendorEnvVars: buildRuntimeVendorEnvVars({
      credential,
      model: binding.model,
      runtimeId,
      vendor,
    }),
  });
  const runtimeProfileIds = await resolveRuntimeProfileIds(bindings, {
    agentId: agent.id,
    kind: binding.kind,
    sessionId: session.id,
  });
  const runtimeProfileResult = createAgentRuntimeProfile({
    agentId: agent.id,
    cloudflareSessionId: runtimeProfileIds.cloudflareSessionId,
    callerUserId: viewer.id,
    configRevision: {
      agentId: binding.agentId,
      deploymentVersionId: binding.deploymentVersionId,
      deploymentVersionNumber: binding.deploymentVersionNumber,
      environmentId: environmentSnapshot.environmentId,
      environmentRevisionId: environmentSnapshot.revisionId,
      runId: null,
      sessionId: session.id,
    },
    envVars,
    executionOwnerUserId: agent.ownerId,
    kind: binding.kind,
    model: binding.model,
    prompt: binding.prompt,
    provider: binding.provider,
    readiness: cached.profile.readiness,
    runtimeId,
    sandboxId: runtimeProfileIds.sandboxId,
    sessionId: session.id,
    setupScript: environmentSnapshot.setupScript,
    spaceBindings: agentMounts,
  });

  return {
    ...cached,
    mcpServers,
    organizationAccessSnapshot: runtimeProfileResult.organizationAccessSnapshot,
    profile: runtimeProfileResult.profile,
  };
}

export async function hydrateCachedRunContextFromSession(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  session: Pick<SessionSummary, "id" | "organizationId"> & {
    accessViewer?: AuthenticatedViewer;
  },
): Promise<{ cacheHit: boolean; value: HydratedSessionRunContext }> {
  const nowMs = Date.now();
  const cacheKey = getHydratedRunContextCacheKey({
    ...(session.accessViewer ? { accessViewerId: session.accessViewer.id } : {}),
    sessionId: session.id,
    viewerId: viewer.id,
  });
  const cached = readHydratedRunContextCache(cacheKey, nowMs);

  if (cached !== null) {
    return {
      cacheHit: true,
      value: await refreshCachedRunContextVolatileFields(bindings, viewer, session, cached),
    };
  }

  const hydrated = await hydrateRunContextFromSession(bindings, viewer, session);
  writeHydratedRunContextCache(cacheKey, hydrated, nowMs);

  return {
    cacheHit: false,
    value: hydrated,
  };
}
