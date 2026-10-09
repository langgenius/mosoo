import { getSessionOrganizationPath } from "@mosoo/agent-driver/paths";
import type { PresetModelProtocol } from "@mosoo/contracts/models";
import type { SessionSummary } from "@mosoo/contracts/session";
import type { UserWarning } from "@mosoo/contracts/session-run";
import type { ResolvedRunSkill } from "@mosoo/contracts/skill";
import { projectsTable, sessionsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type {
  AccountId,
  AgentId,
  ProjectId,
  SandboxId,
  SandboxSessionId,
  SessionId,
} from "@mosoo/id";
import {
  VENDOR_OPENAI_COMPATIBLE,
  getRuntimeCatalogEntry,
  getRuntimeCatalogVendorForProvider,
  resolveRuntimeModelProtocol,
} from "@mosoo/runtime-catalog";
import { eq } from "drizzle-orm";

import { runtimeImagesEnabled } from "../../../../platform/cloudflare/sandbox-binding";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../../platform/db/drizzle";
import { forbiddenError, validationError } from "../../../../platform/errors";
import { isTruthy } from "../../../../shared/truthiness";
import { ensureProjectAgentOwner } from "../../../agents/application/agent-access.service";
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
import { resolveReadyEnvironmentPackageArtifact } from "../../../environments/application/environment-package-artifact.service";
import { resolveEnvironmentSetupScriptForExecution } from "../../../environments/application/environment-runtime-snapshot";
import { resolveRuntimeMcpServersForSnapshot } from "../../../mcp/application/mcp-runtime.service";
import { resolveVendorCredentialRef } from "../../../vendor-credentials/application/vendor-credential.secret-resolution";
import type {
  DriverSkillCatalogEntry,
  DriverVendorCredentialProfile,
} from "../../domain/driver-snapshot";
import { getSupportedRuntimeId } from "../../domain/runtime-config";
import { getRuntimeConversationSession } from "../../infrastructure/runtime-subject-lifecycle/runtime-conversation-session-store";
import { ensureRuntimeSubjectId } from "../../infrastructure/runtime-subject-lifecycle/runtime-subject-record-store";
import { createAgentRuntimeProfile } from "../agent-runtime-profile";
import { getSessionExecutionPlan } from "./session-execution.repository";
import type { HydratedSessionRunContext, SessionExecutionPlan } from "./session-execution.types";
import { resolveSessionSkillReferences } from "./session-skill-reference-resolution.service";

async function resolveSessionExecutionConfiguration(input: {
  database: D1Database;
  plan: SessionExecutionPlan;
  session: { id: SessionId; projectId: ProjectId; accessViewer?: AuthenticatedViewer };
  viewer: AuthenticatedViewer;
}) {
  const authority = await getAppDatabase(input.database)
    .select({
      ownerAccountId: projectsTable.ownerAccountId,
      projectId: sessionsTable.projectId,
    })
    .from(sessionsTable)
    .innerJoin(projectsTable, eq(projectsTable.id, sessionsTable.projectId))
    .where(eq(sessionsTable.id, input.session.id))
    .limit(1)
    .get();
  const accessViewer = input.session.accessViewer ?? input.viewer;
  if (
    !authority ||
    authority.projectId !== input.session.projectId ||
    authority.ownerAccountId !== accessViewer.id ||
    [input.viewer, accessViewer].some(
      (viewer) => viewer.projectId !== undefined && viewer.projectId !== authority.projectId,
    )
  ) {
    throw forbiddenError();
  }

  // Frozen Sessions execute independently of the mutable preset. Only old
  // snapshots without configJson still need the explicit compatibility read.
  let configJson = input.plan.configJson;
  if (configJson === undefined) {
    if (input.plan.binding.agentId === null) {
      throw new Error("A direct Session requires its frozen execution configuration.");
    }
    const agent = await ensureProjectAgentOwner(input.database, accessViewer.id, {
      agentId: input.plan.binding.agentId,
      projectId: authority.projectId,
    });
    if (isTruthy(input.plan.binding.deploymentVersionId)) {
      const version = await getAgentDeploymentVersionRecord(
        input.database,
        input.plan.binding.deploymentVersionId,
      );
      if (version.agentId !== agent.id) throw forbiddenError();
      configJson = version.configJson;
    } else {
      configJson = agent.configJson;
    }
  }

  return {
    executionOwnerUserId: authority.ownerAccountId,
    storedConfig: parseAgentStoredConfig(configJson),
  };
}

function resolveSessionModelProtocol(
  plan: SessionExecutionPlan,
  credential: DriverVendorCredentialProfile,
): PresetModelProtocol {
  const resolution = resolveRuntimeModelProtocol({
    runtimeId: plan.binding.runtimeId,
    vendorId: credential.vendorId,
    modelId: plan.binding.model,
    customModelProtocol: credential.modelProtocol ?? null,
  });
  // Legacy custom Sessions used a fixed protocol per runtime before credentials
  // declared it. Preserve that route without rewriting the historical snapshot.
  const legacyCustomProtocol =
    credential.vendorId === VENDOR_OPENAI_COMPATIBLE.vendorId
      ? plan.binding.runtimeId === "openai-runtime"
        ? "openai-responses"
        : "openai-chat-completions"
      : undefined;
  const selectedProtocol =
    legacyCustomProtocol === undefined
      ? resolution.ok
        ? resolution.modelProtocol
        : undefined
      : (credential.modelProtocol ?? legacyCustomProtocol);
  const frozenProtocol = plan.modelProtocol ?? legacyCustomProtocol ?? selectedProtocol;
  if (
    frozenProtocol !== undefined &&
    selectedProtocol !== undefined &&
    frozenProtocol !== selectedProtocol
  ) {
    throw validationError(
      `The provider model protocol changed from ${frozenProtocol} to ${selectedProtocol}. Restore the original protocol or start a new Session.`,
      "AGENT_SESSION_NOT_READY",
    );
  }
  if (!resolution.ok) {
    throw validationError(resolution.message, "AGENT_SESSION_NOT_READY");
  }
  return frozenProtocol ?? resolution.modelProtocol;
}

async function resolveRuntimeProfileIds(
  bindings: ApiBindings,
  input: {
    agentId: AgentId | null;
    projectId: ProjectId;
    executionOwnerUserId: AccountId;
    runtimeId: string;
    sessionId: SessionId;
  },
): Promise<{
  sandboxSessionId: SandboxSessionId;
  sandboxId: SandboxId;
}> {
  const existingConversationSession = await getRuntimeConversationSession(
    bindings.DB,
    input.sessionId,
  );
  const sandboxId = await ensureRuntimeSubjectId(bindings.DB, {
    runtimeId: input.runtimeId,
    runtimeImagesEnabled: runtimeImagesEnabled(bindings.MOSOO_RUNTIME_IMAGES_ENABLED),
    agentId: input.agentId,
    projectId: input.projectId,
    executionOwnerUserId: input.executionOwnerUserId,
    sessionId: input.sessionId,
    ...(existingConversationSession === null
      ? {}
      : { runtimeSubjectId: existingConversationSession.sandboxId }),
  });

  return {
    sandboxSessionId:
      existingConversationSession?.sandboxSessionId ?? createPlatformId<SandboxSessionId>(),
    sandboxId,
  };
}

export async function hydrateRunContextFromSession(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  session: Pick<SessionSummary, "id"> & {
    accessViewer?: AuthenticatedViewer;
    projectId: ProjectId;
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

  const { executionOwnerUserId, storedConfig } = await resolveSessionExecutionConfiguration({
    database: bindings.DB,
    plan: executionPlan,
    session,
    viewer,
  });
  const environmentSnapshot = executionPlan.environment;
  const toolReferences = executionPlan.tools.toSorted(
    (left, right) => left.sortOrder - right.sortOrder,
  );
  const skillMountRoot = `${getSessionOrganizationPath(session.id)}/.mosoo/skill`;

  const resolvedSkillReferences = await resolveSessionSkillReferences({
    database: bindings.DB,
    sessionProjectId: session.projectId,
    skillMountRoot,
    skillReferences,
  });

  for (const resolvedSkillReference of resolvedSkillReferences) {
    skillCatalog.push(resolvedSkillReference.skillCatalogEntry);
    skills.push(resolvedSkillReference.skill);
    warnings.push(...resolvedSkillReference.warnings);
  }

  const vendor = getRuntimeCatalogVendorForProvider(
    getRuntimeCatalogEntry(runtimeId)!,
    binding.provider,
  );

  if (!vendor) {
    throw new Error(`Runtime ${binding.runtimeId} does not declare vendor ${binding.provider}.`);
  }

  const [vendorCredential, envVars, environmentArtifact, setupScript] = await Promise.all([
    resolveVendorCredentialRef({
      bindings,
      options: { modelId: binding.model },
      projectId: session.projectId,
      vendorId: vendor.vendorId,
    }),
    decryptEnvironmentVariables(bindings, parseStoredEnvVarsJson(environmentSnapshot.envVarsJson)),
    resolveReadyEnvironmentPackageArtifact(
      bindings,
      session.projectId,
      environmentSnapshot.packagesJson,
    ),
    resolveEnvironmentSetupScriptForExecution(bindings.DB, environmentSnapshot),
  ]);

  if (!vendorCredential) {
    throw new Error(`No credential available for ${vendor.label}. Configure in Providers.`);
  }

  const modelProtocol = resolveSessionModelProtocol(executionPlan, vendorCredential);
  const agentReadiness = await computeAgentReadiness(bindings.DB, {
    agentId: binding.agentId,
    builtInTools: executionPlan.builtInTools,
    environment: { environmentId: environmentSnapshot.environmentId },
    mcpServerIds: toolReferences.map((reference) => reference.serverId),
    model: binding.model,
    packageResolution: storedConfig.packageResolution,
    projectId: session.projectId,
    provider: binding.provider,
    runtimeId,
  });

  if (!agentReadiness.ready) {
    throw validationError(
      formatAgentReadinessFailureMessage("Agent is not ready to run", agentReadiness),
      "AGENT_SESSION_NOT_READY",
    );
  }

  const runtimeProfileIds = await resolveRuntimeProfileIds(bindings, {
    runtimeId,
    agentId: binding.agentId,
    projectId: session.projectId,
    executionOwnerUserId,
    sessionId: session.id,
  });

  const profile = createAgentRuntimeProfile({
    agentId: binding.agentId,
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
    executionOwnerUserId,
    model: binding.model,
    modelProtocol,
    network: {
      environmentAllowedHosts: JSON.parse(environmentSnapshot.allowedHostsJson) as string[],
      networkPolicy: environmentSnapshot.networkPolicy,
    },
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
  const mcpServers = await resolveRuntimeMcpServersForSnapshot(bindings.DB, {
    projectId: session.projectId,
    serverIds: toolReferences.map((reference) => reference.serverId),
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
