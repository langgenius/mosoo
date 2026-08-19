import { getSessionOrganizationPath } from "@mosoo/agent-driver/paths";
import type { SessionSummary } from "@mosoo/contracts/session";
import type { UserWarning } from "@mosoo/contracts/session-run";
import type { ResolvedRunSkill } from "@mosoo/contracts/skill";
import { createPlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentId,
  PlatformId,
  AppId,
  SandboxId,
  SandboxSessionId,
  SessionId,
} from "@mosoo/id";
import { getRuntimeCatalogEntry, getRuntimeCatalogVendorForProvider } from "@mosoo/runtime-catalog";
import { getHarnessCatalogEntry } from "@mosoo/runtime-catalog";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { validationError } from "../../../../platform/errors";
import { ensureAppAgentOwner } from "../../../agents/application/agent-access.service";
import { getAgentDeploymentVersionRecord } from "../../../agents/application/agent-deployment-version.service";
import type { AgentDeploymentVersionRecord } from "../../../agents/application/agent-deployment-version.service";
import {
  computeAgentReadiness,
  formatAgentReadinessFailureMessage,
} from "../../../agents/application/agent-readiness.service";
import { parseAgentStoredConfig } from "../../../agents/application/agent-stored-config.service";
import { ensureAppOwnership } from "../../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../../auth/application/viewer-auth.service";
import {
  decryptEnvironmentVariables,
  parseStoredEnvVarsJson,
} from "../../../environments/application/environment-config";
import { resolveReadyEnvironmentPackageArtifact } from "../../../environments/application/environment-package-artifact.service";
import { resolveEnvironmentSetupScriptForExecution } from "../../../environments/application/environment-runtime-snapshot";
import { resolveRuntimeMcpServersForSnapshot } from "../../../mcp/application/mcp-runtime.service";
import { resolveVendorCredentialRef } from "../../../vendor-credentials/application/vendor-credential.service";
import type {
  DriverNetworkProfile,
  DriverProfileConfig,
  DriverSkillCatalogEntry,
} from "../../domain/driver-snapshot";
import { getSupportedRuntimeId } from "../../domain/runtime-config";
import { resolveAgentRuntimeSandboxSubject } from "../../domain/runtime-sandbox-subject";
import { parseEnvironmentAllowedHosts } from "../../domain/sandbox-network-constraints";
import {
  ensureRuntimeSubjectId,
  getRuntimeConversationSession,
} from "../../infrastructure/runtime-subject-lifecycle/runtime-subject-store";
import { createAgentRuntimeProfile } from "../agent-runtime-profile";
import {
  appendRuntimeDiagnosticEvent,
  toRuntimeDiagnosticBaseValue,
  toRuntimeDiagnosticReason,
} from "../runtime-diagnostic-events";
import { getSessionExecutionPlan } from "./session-execution.repository";
import type { HydratedSessionRunContext, SessionExecutionPlan } from "./session-execution.types";
import { resolveSessionSkillReferences } from "./session-skill-reference-resolution.service";
import { buildSnapshotAgentEnvironment } from "./session-snapshot-hydration";

interface HydratedRunContextCacheEntry {
  expiresAtMs: number;
  value: HydratedSessionRunContext;
}

const HYDRATED_RUN_CONTEXT_CACHE_TTL_MS = 20_000;
const hydratedRunContextCache = new Map<string, HydratedRunContextCacheEntry>();

async function resolveRuntimeProfileIds(
  bindings: ApiBindings,
  input: {
    agentId: AgentId;
    appId: AppId;
    executionOwnerUserId: AccountId;
    kind: DriverProfileConfig["kind"];
    sessionId: SessionId;
  },
): Promise<{
  sandboxSessionId: SandboxSessionId;
  sandboxId: SandboxId;
}> {
  const sandboxSubject = resolveAgentRuntimeSandboxSubject(input);
  const [sandboxId, existingConversationSession] = await Promise.all([
    ensureRuntimeSubjectId(bindings.DB, {
      ...sandboxSubject,
      agentId: input.agentId,
      appId: input.appId,
      executionOwnerUserId: input.executionOwnerUserId,
    }),
    getRuntimeConversationSession(bindings.DB, input.sessionId),
  ]);

  return {
    sandboxSessionId:
      existingConversationSession?.sandboxSessionId ?? createPlatformId<SandboxSessionId>(),
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

interface ResolvedExecutionSourceContext {
  agentId: AgentId;
  deploymentVersion: AgentDeploymentVersionRecord | null;
  executionOwnerUserId: AccountId;
  kind: "agent" | "harness";
  storedConfig: ReturnType<typeof parseAgentStoredConfig>;
}

async function resolveExecutionSourceContext(input: {
  accessViewerId: AccountId;
  bindings: ApiBindings;
  executionPlan: SessionExecutionPlan;
  appId: AppId;
}): Promise<ResolvedExecutionSourceContext> {
  const source = input.executionPlan.source;
  const binding = input.executionPlan.binding;

  if (source.kind === "agent") {
    if (source.agentId !== binding.agentId) {
      throw new Error("Session Agent source does not match its execution binding.");
    }

    const [agent, deploymentVersion] = await Promise.all([
      ensureAppAgentOwner(input.bindings.DB, input.accessViewerId, {
        agentId: source.agentId as AgentId,
        appId: input.appId,
      }).then((access) => access.agent),
      binding.deploymentVersionId
        ? getAgentDeploymentVersionRecord(input.bindings.DB, binding.deploymentVersionId)
        : Promise.resolve(null),
    ]);

    return {
      agentId: agent.id,
      deploymentVersion,
      executionOwnerUserId: agent.ownerId,
      kind: "agent",
      storedConfig: parseAgentStoredConfig(deploymentVersion?.configJson ?? agent.configJson),
    };
  }

  if (binding.kind !== "cattle") {
    throw new Error("Harness Runs require Cattle session isolation.");
  }

  const harness = getHarnessCatalogEntry(source.harness);
  if (
    harness === null ||
    harness.status !== "available" ||
    harness.version !== source.version ||
    harness.runtimeId !== binding.runtimeId
  ) {
    throw new Error(`Frozen Harness ${source.harness}@${source.version} is unavailable.`);
  }

  const workspace = await ensureAppOwnership(input.bindings.DB, input.accessViewerId, input.appId);

  return {
    agentId: binding.agentId,
    deploymentVersion: null,
    executionOwnerUserId: workspace.ownerAccountId,
    kind: "harness",
    storedConfig: parseAgentStoredConfig("{}"),
  };
}

export function toDriverNetworkProfile(input: {
  environment: { allowedHostsJson: string; networkPolicy: DriverNetworkProfile["networkPolicy"] };
}): DriverNetworkProfile {
  return {
    environmentAllowedHosts: parseEnvironmentAllowedHosts(input.environment.allowedHostsJson),
    networkPolicy: input.environment.networkPolicy,
  };
}
async function hydrateRunContextFromSession(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  session: Pick<SessionSummary, "id"> & {
    accessViewer?: AuthenticatedViewer;
    appId: AppId;
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

  const sourceContext = await resolveExecutionSourceContext({
    accessViewerId: session.accessViewer?.id ?? viewer.id,
    bindings,
    executionPlan,
    appId: session.appId,
  });
  const storedConfig = sourceContext.storedConfig;
  const environmentSnapshot = executionPlan.environment;
  const toolReferences = executionPlan.tools.toSorted(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  const snapshotEnvironment = buildSnapshotAgentEnvironment({
    environmentId: environmentSnapshot.environmentId,
  });
  // No `bindings` here on purpose: passing them makes readiness run a live
  // provider probe (GET /models plus a possible POST /chat/completions, 10s
  // timeout each) on the first-token critical path. D1-backed checks still
  // gate the run; broken credentials surface from the actual model call.
  // Config/publish readiness callers keep the live probe.
  const agentReadiness = await computeAgentReadiness(
    bindings.DB,
    sourceContext.executionOwnerUserId,
    {
      agentId: sourceContext.agentId,
      environment: snapshotEnvironment,
      environmentNetworkPolicy: environmentSnapshot.networkPolicy,
      kind: binding.kind,
      mcpServerIds: toolReferences.map((reference) => reference.serverId),
      model: binding.model,
      packageResolution: storedConfig.packageResolution,
      appId: session.appId,
      provider: binding.provider,
      runtimeId,
    },
  );

  if (!agentReadiness.ready) {
    throw validationError(
      formatAgentReadinessFailureMessage("Agent is not ready to run", agentReadiness),
      "AGENT_SESSION_NOT_READY",
    );
  }

  const skillMountRoot = `${getSessionOrganizationPath(session.id)}/.mosoo/skill`;

  const resolvedSkillReferences = await resolveSessionSkillReferences({
    database: bindings.DB,
    sessionAppId: session.appId,
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

  const [vendorCredential, envVars, environmentArtifact, setupScript] = await Promise.all([
    resolveVendorCredentialRef({
      bindings,
      executionOwnerUserId: sourceContext.executionOwnerUserId,
      options: { modelId: binding.model },
      appId: session.appId,
      vendorId: vendor.vendorId,
    }),
    decryptEnvironmentVariables(bindings, {
      environmentId: environmentSnapshot.environmentId,
      envVars: parseStoredEnvVarsJson(environmentSnapshot.envVarsJson),
    }),
    resolveReadyEnvironmentPackageArtifact(
      bindings,
      session.appId,
      environmentSnapshot.packagesJson,
    ),
    resolveEnvironmentSetupScriptForExecution(bindings.DB, environmentSnapshot),
  ]);

  if (!vendorCredential) {
    await appendRuntimeDiagnosticEvent(bindings, {
      eventName: RUNTIME_DIAGNOSTIC_EVENT.configCredentialMissing.name,
      sessionId: session.id,
      value: {
        ...toRuntimeDiagnosticBaseValue({
          agentId: sourceContext.agentId,
          sessionId: session.id,
        }),
        provider: binding.provider,
        reason: "no_active_key",
      },
    });
    throw new Error(`No credential available for ${vendor.label}. Configure in Providers.`);
  }

  let profile: DriverProfileConfig;
  const runtimeProfileIds = await resolveRuntimeProfileIds(bindings, {
    agentId: sourceContext.agentId,
    appId: session.appId,
    executionOwnerUserId: sourceContext.executionOwnerUserId,
    kind: binding.kind,
    sessionId: session.id,
  });

  try {
    profile = createAgentRuntimeProfile({
      agentId: sourceContext.agentId,
      sandboxSessionId: runtimeProfileIds.sandboxSessionId,
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
      environmentArtifact,
      executionOwnerUserId: sourceContext.executionOwnerUserId,
      kind: binding.kind,
      model: binding.model,
      network: toDriverNetworkProfile({
        environment: environmentSnapshot,
      }),
      prompt: binding.prompt,
      provider: binding.provider,
      providerOptions: storedConfig.providerOptions,
      readiness: agentReadiness,
      runtimeId,
      sandboxId: runtimeProfileIds.sandboxId,
      sessionId: session.id,
      setupScript,
      vendorCredential,
    });
  } catch (error) {
    await appendRuntimeDiagnosticEvent(bindings, {
      eventName: RUNTIME_DIAGNOSTIC_EVENT.configManifestRenderFailed.name,
      sessionId: session.id,
      value: {
        ...toRuntimeDiagnosticBaseValue({
          agentId: sourceContext.agentId,
          sessionId: session.id,
        }),
        fieldPath: "runtimeProfile",
        reason: toRuntimeDiagnosticReason(error, "Runtime manifest render failed."),
      },
    });
    throw error;
  }
  const mcpServers =
    sourceContext.kind === "harness" || toolReferences.length === 0
      ? []
      : await resolveRuntimeMcpServersForSnapshot(bindings, {
          agentId: sourceContext.agentId,
          bindings: toolReferences.map((reference) => ({
            agentCredentialId: reference.agentCredentialId,
            credentialMode: reference.credentialMode,
            enabled: true,
            serverId: reference.serverId,
            sortOrder: reference.sortOrder,
          })),
          callerUserId: viewer.id,
          executionOwnerUserId: sourceContext.executionOwnerUserId,
        });

  return {
    builtInTools: executionPlan.builtInTools,
    mcpServers,
    profile,
    skillCatalog,
    skills,
    warnings,
  };
}

async function refreshCachedRunContextVolatileFields(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  session: Pick<SessionSummary, "id"> & {
    accessViewer?: AuthenticatedViewer;
    appId: AppId;
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

  const sourceContext = await resolveExecutionSourceContext({
    accessViewerId: session.accessViewer?.id ?? viewer.id,
    bindings,
    executionPlan,
    appId: session.appId,
  });
  const storedConfig = sourceContext.storedConfig;
  const catalogEntry = getRuntimeCatalogEntry(runtimeId);

  if (catalogEntry === null) {
    throw new Error(`Unsupported runtime: ${runtimeId}.`);
  }

  const vendor = getRuntimeCatalogVendorForProvider(catalogEntry, binding.provider);

  if (!vendor) {
    throw new Error(`Runtime ${binding.runtimeId} does not declare vendor ${binding.provider}.`);
  }

  const environmentSnapshot = executionPlan.environment;
  const toolReferences = executionPlan.tools.toSorted(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  const [vendorCredential, envVars, mcpServers] = await Promise.all([
    resolveVendorCredentialRef({
      bindings,
      executionOwnerUserId: sourceContext.executionOwnerUserId,
      options: { modelId: binding.model },
      appId: session.appId,
      vendorId: vendor.vendorId,
    }),
    decryptEnvironmentVariables(bindings, {
      environmentId: environmentSnapshot.environmentId,
      envVars: parseStoredEnvVarsJson(environmentSnapshot.envVarsJson),
    }),
    toolReferences.length > 0 && sourceContext.kind === "agent"
      ? resolveRuntimeMcpServersForSnapshot(bindings, {
          agentId: sourceContext.agentId,
          bindings: toolReferences.map((reference) => ({
            agentCredentialId: reference.agentCredentialId,
            credentialMode: reference.credentialMode,
            enabled: true,
            serverId: reference.serverId,
            sortOrder: reference.sortOrder,
          })),
          callerUserId: viewer.id,
          executionOwnerUserId: sourceContext.executionOwnerUserId,
        })
      : Promise.resolve([]),
  ]);

  if (!vendorCredential) {
    throw new Error(`No credential available for ${vendor.label}. Configure in Providers.`);
  }

  const runtimeProfileIds = await resolveRuntimeProfileIds(bindings, {
    agentId: sourceContext.agentId,
    appId: session.appId,
    executionOwnerUserId: sourceContext.executionOwnerUserId,
    kind: binding.kind,
    sessionId: session.id,
  });
  const profile = createAgentRuntimeProfile({
    agentId: sourceContext.agentId,
    sandboxSessionId: runtimeProfileIds.sandboxSessionId,
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
    environmentArtifact: cached.profile.environmentArtifact ?? null,
    executionOwnerUserId: sourceContext.executionOwnerUserId,
    kind: binding.kind,
    model: binding.model,
    network: toDriverNetworkProfile({
      environment: environmentSnapshot,
    }),
    prompt: binding.prompt,
    provider: binding.provider,
    providerOptions: storedConfig.providerOptions,
    readiness: cached.profile.readiness,
    runtimeId,
    sandboxId: runtimeProfileIds.sandboxId,
    sessionId: session.id,
    setupScript: environmentSnapshot.setupScript,
    vendorCredential,
  });

  return {
    ...cached,
    builtInTools: executionPlan.builtInTools,
    mcpServers,
    profile,
  };
}

export async function hydrateCachedRunContextFromSession(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  session: Pick<SessionSummary, "id"> & {
    accessViewer?: AuthenticatedViewer;
    appId: AppId;
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
