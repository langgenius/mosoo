/**
 * Mosoo Native Deployment Protocol v1 — agent upsert for protocol repos.
 *
 * One deploy upserts every agent the repo defines inside the target App
 * (PRD "Upsert, not bind"). Identity is the EXACT agent name within the App:
 * a new name creates a draft through the `.agent` package import machinery
 * and auto-publishes it; an existing name is updated in place with repo-owned
 * fields only and re-versioned. Agents that exist in the App but not in the
 * repo are never touched, and nothing is ever deleted.
 *
 * Contract discipline:
 * - This service never throws for per-repo problems; it reports a `blocking`
 *   outcome with a stable {@link NativeRunErrorCode} so the deployment
 *   executor can terminal-fail the run without leaking exception classes.
 * - Publish readiness failures (pending environment secrets, missing provider
 *   credentials, unavailable models, unconnected MCP servers) become
 *   `native_setup_required` with a repo-term per-agent message pointing at
 *   App settings; the agent row stays behind as a draft so the next deploy
 *   adopts it by name (idempotent re-entry after a crash or blocked publish).
 * - Ambiguous names (more than one existing agent with the same name) block
 *   the whole deploy with `native_agent_name_ambiguous` before any write, per
 *   the PRD no-guessing rule.
 *
 * Normalization happens here, not in the executor: repo snapshot files plus
 * Phase 0 validate facts go in, {@link NormalizedNativeAgent} values (parsed
 * agent packages with sidecars merged and skill assets attached) come out.
 * MCP catalog entries are re-scoped to the app-shaped binding form before the
 * package parse because the shared sidecar admission normalizes servers to a
 * personal scope the package reader rejects; native MCP intent is always
 * app-scoped needs_reconnect posture (credentials never travel with a repo).
 */
import {
  attachEnvironmentDefinition,
  createEmptyResolutionSummary,
  createPackageResolutionState,
  createResolutionReport,
  mergeMcpSidecarJson,
  readPackageAssets,
} from "@mosoo/agent-package";
import type {
  AgentManifest,
  AgentManifestMcpServerBinding,
  AgentPackage,
  AgentPackageAsset,
  AgentPackageResolutionSummary,
  AgentResolutionIssue,
} from "@mosoo/contracts/agent-manifest";
import {
  attachAgentPackageAssets,
  parseAgentPackageJson,
} from "@mosoo/contracts/agent-manifest-parser";
import { NATIVE_AGENT_DIR } from "@mosoo/contracts/native-deployment";
import type { NativeValidateAgentFact } from "@mosoo/contracts/native-deployment";
import type {
  NativeAgentProvisionAction,
  NativeRunErrorCode,
} from "@mosoo/contracts/native-deployment-run";
import { agentDeploymentVersionsTable, agentSkillsTable, agentsTable } from "@mosoo/db";
import type { AgentId, AppId, SkillId } from "@mosoo/id";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import { zipSync } from "fflate";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, runAppDatabaseBatch } from "../../../platform/db/drizzle";
import { API_ERROR_CODE, isApiError } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import { ensureAppOwnership } from "../../apps/application/app.service";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { listAppSkillRows } from "../../skills/application/skill-access.service";
import {
  createSkillFromUpload,
  updateOwnedSkillPackage,
} from "../../skills/application/skill-package-write.service";
import { prepareAgentDeploymentVersionCandidate } from "./agent-deployment-version.service";
import { loadAgentEnvironmentConfig } from "./agent-environment.service";
import { enforceAgentKindChangeAllowed } from "./agent-kind-policy.service";
import { publishAgent } from "./agent-lifecycle-command.service";
import { createDraftAgentBatch } from "./agent-package-draft.service";
import { resolvePackageMcpServers } from "./agent-package-mcp-resolution.service";
import {
  collectPackageDeclarationIssues,
  collectRuntimeResolutionIssues,
  resolvePackageEnvironment,
  resolvePackageSkills,
} from "./agent-package-resolution.service";
import type { PackageSkillResolution } from "./agent-package-resolution.service";
import { readSkillId, readSkillSnapshotId } from "./agent-platform-ids";
import { computeAgentReadiness } from "./agent-readiness.service";
import { getAgentRow, listAppOwnerAgentRows } from "./agent-repository";
import {
  buildAgentSpecForPreparedProfile,
  listAgentSpecMcpBindings,
  listAgentSpecSkillsByIds,
} from "./agent-spec.service";
import { parseAgentStoredConfig, serializeAgentStoredConfig } from "./agent-stored-config.service";
import type { AgentStoredPackageSkill } from "./agent-stored-config.service";
import type { AgentRow } from "./agent-types";
import {
  createAgentConfigChangeSnapshot,
  enforcePublishedRuntimeStability,
  listAgentSkillIds,
  planVersionedAgentConfigChange,
  summarizeVersionedAgentConfigChange,
} from "./agent-versioned-config.service";
import { assertRuntimeAdvancedSettings } from "./runtime-advanced-settings-validation.service";

const NATIVE_AGENT_DIR_PREFIX = `${NATIVE_AGENT_DIR}/`;
const PRIMARY_MANIFEST_PATH = `${NATIVE_AGENT_DIR}/manifest.json`;
const NAMED_AGENT_DIR_PREFIX = `${NATIVE_AGENT_DIR}/agents/`;

const textEncoder = new TextEncoder();

/** Repo agent normalized to the `.agent` package shape the import path consumes. */
export interface NormalizedNativeAgent {
  exposed: boolean;
  /** Repo-relative manifest path, for repo-term diagnostics. */
  manifestPath: string;
  name: string;
  /** Sidecar-merged package with environment attached and skill assets read. */
  package: AgentPackage;
}

export type NativeAgentNormalization =
  | { agent: NormalizedNativeAgent; ok: true }
  | { manifestPath: string; name: string; ok: false; problem: string };

export interface UpsertNativeRepoAgentsInput {
  /** Phase 0 validate facts for the agents to provision, in repo order. */
  agents: readonly NativeValidateAgentFact[];
  appId: AppId;
  /** Repo snapshot file map (must include the `.agent/` subtree). */
  files: Readonly<Record<string, string>>;
  sourceCommitSha: string | null;
}

export interface NativeRepoAgentUpsertResult {
  action: NativeAgentProvisionAction;
  /** Null when provisioning failed before an agent row existed. */
  agentId: AgentId | null;
  name: string;
  /** Minted DeploymentVersion number; omitted when none was minted. */
  versionNumber?: number;
}

export interface NativeRepoUpsertBlocking {
  code: NativeRunErrorCode;
  /** Per-agent repo-term failure lines for run diagnostics. */
  failures?: readonly string[];
  message: string;
}

export interface NativeRepoUpsertOutcome {
  blocking?: NativeRepoUpsertBlocking;
  results: NativeRepoAgentUpsertResult[];
}

/**
 * Upserts every repo-defined agent into the App and auto-publishes them.
 * Never deletes; never throws for repo-shaped failures (returns `blocking`).
 */
export async function upsertNativeRepoAgents(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: UpsertNativeRepoAgentsInput,
): Promise<NativeRepoUpsertOutcome> {
  try {
    return await upsertNativeRepoAgentsUnsafe(bindings, viewer, input);
  } catch (error) {
    return {
      blocking: {
        code: "native_provision_failed",
        message: `Agent provisioning failed: ${errorMessage(error)}`,
      },
      results: input.agents.map((fact) => ({
        action: "failed",
        agentId: null,
        name: fact.name,
      })),
    };
  }
}

async function upsertNativeRepoAgentsUnsafe(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  input: UpsertNativeRepoAgentsInput,
): Promise<NativeRepoUpsertOutcome> {
  await ensureAppOwnership(bindings.DB, viewer.id, input.appId);

  const existingRows = await listAppOwnerAgentRows(bindings.DB, {
    appId: input.appId,
    viewerId: viewer.id,
  });
  const rowsByName = new Map<string, AgentRow[]>();

  for (const row of existingRows) {
    const rows = rowsByName.get(row.name) ?? [];
    rows.push(row);
    rowsByName.set(row.name, rows);
  }

  const ambiguousFailures = input.agents.flatMap((fact) => {
    const matches = rowsByName.get(fact.name) ?? [];

    if (matches.length <= 1) {
      return [];
    }

    return [
      `Agent name "${fact.name}" matches ${matches.length} existing agents in this App; Mosoo never guesses which one to update. Rename or remove the duplicates in the App, then redeploy.`,
    ];
  });

  if (ambiguousFailures.length > 0) {
    return {
      blocking: {
        code: "native_agent_name_ambiguous",
        failures: ambiguousFailures,
        message: ambiguousFailures.join(" "),
      },
      results: input.agents.map((fact) => ({ action: "failed", agentId: null, name: fact.name })),
    };
  }

  const normalizations = normalizeNativeRepoAgents({ agents: input.agents, files: input.files });
  const normalizationFailures = normalizations.flatMap((normalization) =>
    normalization.ok
      ? []
      : [`Agent "${normalization.name}" (${normalization.manifestPath}): ${normalization.problem}`],
  );

  if (normalizationFailures.length > 0) {
    return {
      blocking: {
        code: "native_provision_failed",
        failures: normalizationFailures,
        message: `Agent provisioning failed. ${normalizationFailures.join(" ")}`,
      },
      results: input.agents.map((fact) => ({ action: "failed", agentId: null, name: fact.name })),
    };
  }

  const results: NativeRepoAgentUpsertResult[] = [];
  const setupFailures: string[] = [];
  const hardFailures: string[] = [];

  for (const normalization of normalizations) {
    if (!normalization.ok) {
      continue;
    }

    const normalized = normalization.agent;
    const existing = (rowsByName.get(normalized.name) ?? [])[0] ?? null;

    try {
      const result =
        existing === null
          ? await provisionNewNativeAgent(
              bindings,
              viewer,
              input.appId,
              normalized,
              setupFailures,
              input.sourceCommitSha,
            )
          : await provisionExistingNativeAgent(
              bindings,
              viewer,
              input.appId,
              existing,
              normalized,
              setupFailures,
              input.sourceCommitSha,
            );

      if (result.agentId !== null) {
        await persistAgentApiExposure(bindings.DB, result.agentId, normalized.exposed);
      }

      results.push(result);
    } catch (error) {
      hardFailures.push(`Agent "${normalized.name}": ${errorMessage(error)}`);
      results.push({
        action: "failed",
        agentId: existing === null ? null : existing.id,
        name: normalized.name,
      });
    }
  }

  if (hardFailures.length > 0) {
    return {
      blocking: {
        code: "native_provision_failed",
        failures: [...hardFailures, ...setupFailures],
        message: `Agent provisioning failed. ${hardFailures.join(" ")}`,
      },
      results,
    };
  }

  if (setupFailures.length > 0) {
    return {
      blocking: {
        code: "native_setup_required",
        failures: setupFailures,
        message: setupFailures.join(" "),
      },
      results,
    };
  }

  return { results };
}

/**
 * Projects the repo's expose subset onto the agent row (PRD "API Namespace &
 * Access"): 1 = exposed, 0 = repo-defined but internal — including the agent
 * that DROPPED out of the expose subset on a later deploy of the same repo.
 * NULL (console-created) rows are only ever written here once the repo
 * defines the name. The guarded WHERE keeps idempotent re-deploys write-free
 * so an unchanged agent row stays byte-identical (updatedAt included).
 */
async function persistAgentApiExposure(
  database: D1Database,
  agentId: AgentId,
  exposed: boolean,
): Promise<void> {
  const exposedViaApi = exposed ? 1 : 0;

  await getAppDatabase(database)
    .update(agentsTable)
    .set({ exposedViaApi, updatedAt: currentTimestampMs() })
    .where(
      and(
        eq(agentsTable.id, agentId),
        or(isNull(agentsTable.exposedViaApi), ne(agentsTable.exposedViaApi, exposedViaApi)),
      ),
    )
    .run();
}

async function provisionNewNativeAgent(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  appId: AppId,
  normalized: NormalizedNativeAgent,
  setupFailures: string[],
  sourceCommitSha: string | null,
): Promise<NativeRepoAgentUpsertResult> {
  const agentRow = await createNativeRepoDraftAgent(bindings, viewer, appId, normalized);
  const publish = await publishNativeRepoAgent(bindings, viewer, agentRow, sourceCommitSha);

  if (publish.kind === "setup") {
    setupFailures.push(toSetupFailureLine(normalized.name, publish.issues));
    return { action: "failed", agentId: agentRow.id, name: normalized.name };
  }

  return {
    action: "created",
    agentId: agentRow.id,
    name: normalized.name,
    ...(publish.versionNumber === undefined ? {} : { versionNumber: publish.versionNumber }),
  };
}

async function provisionExistingNativeAgent(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  appId: AppId,
  existing: AgentRow,
  normalized: NormalizedNativeAgent,
  setupFailures: string[],
  sourceCommitSha: string | null,
): Promise<NativeRepoAgentUpsertResult> {
  const updated = await updateNativeRepoAgent(
    bindings,
    viewer,
    appId,
    existing,
    normalized,
    sourceCommitSha,
  );

  // A live-published update whose new version failed the readiness gate is
  // never activated: surface it as setup_required (mirrors the new-agent path)
  // so the working endpoint keeps serving the prior version.
  if (updated.setupIssues !== undefined) {
    setupFailures.push(toSetupFailureLine(normalized.name, updated.setupIssues));
    return { action: "failed", agentId: existing.id, name: normalized.name };
  }

  if (!updated.changed) {
    return { action: "unchanged", agentId: existing.id, name: normalized.name };
  }

  if (
    updated.agentRow.status === "published" &&
    isTruthy(updated.agentRow.liveDeploymentVersionId)
  ) {
    return {
      action: "updated",
      agentId: existing.id,
      name: normalized.name,
      ...(updated.versionNumber === undefined ? {} : { versionNumber: updated.versionNumber }),
    };
  }

  // Draft adoption: a prior create-then-publish crash (or blocked publish)
  // left the row unpublished; the repo re-run must finish the publish.
  const publish = await publishNativeRepoAgent(bindings, viewer, updated.agentRow, sourceCommitSha);

  if (publish.kind === "setup") {
    setupFailures.push(toSetupFailureLine(normalized.name, publish.issues));
    return { action: "failed", agentId: existing.id, name: normalized.name };
  }

  return {
    action: "updated",
    agentId: existing.id,
    name: normalized.name,
    ...(publish.versionNumber === undefined ? {} : { versionNumber: publish.versionNumber }),
  };
}

/** Mirrors the `.agent` package import creation path (manifest in memory). */
async function createNativeRepoDraftAgent(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  appId: AppId,
  normalized: NormalizedNativeAgent,
): Promise<AgentRow> {
  const database = bindings.DB;
  const { manifest } = normalized.package;
  const providerOptions = assertRuntimeAdvancedSettings({
    runtimeId: manifest.runtime.id,
    settings: manifest.runtime.providerOptions,
  });
  const summary = createEmptyResolutionSummary();
  const issues: AgentResolutionIssue[] = [];

  issues.push(...collectPackageDeclarationIssues(normalized.package));
  issues.push(...(await collectRuntimeResolutionIssues(database, viewer.id, appId, manifest)));

  const [skillResolution, environmentId, mcpServerIds] = await Promise.all([
    resolvePackageSkills({
      bindings,
      database,
      issues,
      manifest,
      packageAssets: normalized.package.assets,
      appId,
      summary,
      viewer,
      viewerId: viewer.id,
    }),
    resolvePackageEnvironment({
      allowTargetNameMatch: true,
      appId,
      database,
      issues,
      manifest,
    }),
    resolvePackageMcpServers({
      issues,
      manifest,
      summary,
    }),
  ]);
  const resolution = createResolutionReport(issues, summary);

  return createDraftAgentBatch(database, {
    agentName: normalized.name,
    builtInTools: manifest.builtInTools,
    description: manifest.metadata.description,
    environmentId,
    kind: manifest.kind,
    mcpServerIds,
    model: manifest.runtime.model,
    ownerId: viewer.id,
    packageMcpServers: manifest.mcpServers,
    packageResolution: createPackageResolutionState("import", resolution),
    packageSkills: skillResolution.packageSkills,
    prompt: manifest.prompts.system,
    provider: manifest.runtime.provider,
    providerOptions,
    appId,
    runtimeId: manifest.runtime.id,
    skillIds: skillResolution.skillIds,
  });
}

interface NativeRepoAgentUpdate {
  agentRow: AgentRow;
  changed: boolean;
  /**
   * Error-severity readiness messages when a live-version activation was
   * blocked on the publish-readiness gate; present means nothing was written
   * and the existing live version stays intact.
   */
  setupIssues?: readonly string[];
  versionNumber?: number;
}

/**
 * Targeted update of repo-owned fields only. Instance-connected MCP bindings
 * and console-attached skills stay intact (repo skill ids are merged in, not
 * swapped wholesale), which is why this does not go through the console's
 * `updateAgentConfig`.
 */
async function updateNativeRepoAgent(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  appId: AppId,
  existing: AgentRow,
  normalized: NormalizedNativeAgent,
  sourceCommitSha: string | null,
): Promise<NativeRepoAgentUpdate> {
  const database = bindings.DB;
  const { manifest } = normalized.package;
  const storedConfig = parseAgentStoredConfig(existing.configJson);

  enforceAgentKindChangeAllowed(existing, manifest.kind);
  enforcePublishedRuntimeStability(existing, manifest.runtime.id);

  const providerOptionsUnchanged =
    stableStringify(storedConfig.providerOptions) ===
    stableStringify(manifest.runtime.providerOptions);
  const providerOptions = assertRuntimeAdvancedSettings({
    allowLegacyUnsupportedSettings: providerOptionsUnchanged,
    runtimeId: manifest.runtime.id,
    settings: manifest.runtime.providerOptions,
  });

  const summary = createEmptyResolutionSummary();
  const issues: AgentResolutionIssue[] = [];

  issues.push(...collectPackageDeclarationIssues(normalized.package));
  issues.push(...(await collectRuntimeResolutionIssues(database, viewer.id, appId, manifest)));

  const [skillResolution, resolvedEnvironmentId] = await Promise.all([
    resolveNativeRepoUpdateSkills({
      bindings,
      existingPackageSkills: storedConfig.packageSkills,
      issues,
      manifest,
      packageAssets: normalized.package.assets,
      appId,
      summary,
      viewer,
    }),
    resolvePackageEnvironment({
      allowTargetNameMatch: true,
      appId,
      database,
      issues,
      manifest,
    }),
  ]);

  await resolvePackageMcpServers({ issues, manifest, summary });

  const resolution = createResolutionReport(issues, summary);
  // Environment is only repo-owned when the manifest declares a reference;
  // otherwise the instance keeps whatever it has. An unresolvable declared
  // reference also keeps the instance value (the issue is recorded instead).
  const declaresEnvironment =
    isTruthy(manifest.environment.environmentId) || isTruthy(manifest.environment.expectedName);
  const environmentId = declaresEnvironment
    ? (resolvedEnvironmentId ?? existing.environmentId)
    : existing.environmentId;

  const currentSkillIds = await listAgentSkillIds(database, existing.id);
  const skillIds = mergeSkillIds(currentSkillIds, skillResolution.skillIds);
  const packageResolutionState = createPackageResolutionState("import", resolution);
  const nextConfigJson = serializeAgentStoredConfig({
    builtInTools: manifest.builtInTools,
    packageMcpServers: manifest.mcpServers,
    packageSkills: skillResolution.packageSkills,
    packageResolution: packageResolutionState,
    providerOptions,
  });

  // Instance MCP bindings are never repo-driven, so both snapshots see the
  // same (empty) binding list and MCP changes can never be attributed here.
  const changePlan = planVersionedAgentConfigChange({
    agentStatus: existing.status,
    current: createAgentConfigChangeSnapshot({
      agent: {
        ...existing,
        builtInTools: storedConfig.builtInTools,
        providerOptions: storedConfig.providerOptions,
      },
      environment: { environmentId: existing.environmentId },
      mcpServerIds: [],
      skillIds: currentSkillIds,
    }),
    next: createAgentConfigChangeSnapshot({
      agent: {
        ...existing,
        builtInTools: manifest.builtInTools,
        description: manifest.metadata.description,
        kind: manifest.kind,
        model: manifest.runtime.model,
        prompt: manifest.prompts.system,
        provider: manifest.runtime.provider,
        providerOptions,
        runtimeId: manifest.runtime.id,
      },
      environment: { environmentId },
      mcpServerIds: [],
      skillIds,
    }),
  });
  const packageSkillsChanged =
    stableStringify(storedConfig.packageSkills.map(projectPackageSkill)) !==
    stableStringify(skillResolution.packageSkills.map(projectPackageSkill));
  const packageMcpServersChanged =
    stableStringify(storedConfig.packageMcpServers.map(projectPackageMcpServer)) !==
    stableStringify(manifest.mcpServers.map(projectPackageMcpServer));
  const changed =
    changePlan.fieldLabels.length > 0 || packageSkillsChanged || packageMcpServersChanged;
  const isLivePublished =
    existing.status === "published" && isTruthy(existing.liveDeploymentVersionId);

  if (!changed && isLivePublished) {
    return { agentRow: existing, changed: false };
  }

  const timestampMs = currentTimestampMs();
  const nextAgent: AgentRow = {
    ...existing,
    configJson: nextConfigJson,
    description: manifest.metadata.description,
    environmentId,
    kind: manifest.kind,
    model: manifest.runtime.model,
    prompt: manifest.prompts.system,
    provider: manifest.runtime.provider,
    runtimeId: manifest.runtime.id,
    updatedAt: timestampMs,
  };
  const requiresVersion =
    isLivePublished &&
    (changePlan.requiresDeploymentVersion || packageSkillsChanged || packageMcpServersChanged);

  // Publish-readiness gate for the update-of-live path: activating a new live
  // version whose provider/model/env/mcp is not set up here would report a
  // green deploy over a broken endpoint. Mirror publishNativeRepoAgent and
  // block instead of activating; nothing has been written yet.
  if (requiresVersion) {
    const readiness = await computeAgentReadiness(database, nextAgent.ownerId, {
      agentId: nextAgent.id,
      bindings,
      environment: await loadAgentEnvironmentConfig(database, nextAgent.id, environmentId),
      model: nextAgent.model,
      packageResolution: packageResolutionState,
      appId: nextAgent.appId,
      provider: nextAgent.provider,
      runtimeId: nextAgent.runtimeId,
    });

    if (!readiness.ready) {
      return {
        agentRow: existing,
        changed: false,
        setupIssues: readiness.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.message),
      };
    }
  }

  const version = requiresVersion
    ? await prepareNativeRepoVersion(database, viewer, {
        agent: nextAgent,
        environmentId,
        skillIds,
        sourceCommitSha,
        summary:
          changePlan.fieldLabels.length > 0
            ? summarizeVersionedAgentConfigChange(changePlan)
            : "Repo deploy update",
        timestampMs,
      })
    : null;
  const skillRows = skillIds.map((skillId, index) => ({
    agentId: existing.id,
    createdAt: timestampMs,
    skillId,
    sortOrder: index,
  }));

  await runAppDatabaseBatch(database, (db) => [
    db
      .update(agentsTable)
      .set({
        configJson: nextConfigJson,
        description: manifest.metadata.description,
        environmentId,
        kind: manifest.kind,
        ...(version === null ? {} : { liveDeploymentVersionId: version.record.id }),
        model: manifest.runtime.model,
        prompt: manifest.prompts.system,
        provider: manifest.runtime.provider,
        runtimeId: manifest.runtime.id,
        updatedAt: timestampMs,
      })
      .where(eq(agentsTable.id, existing.id)),
    ...(version === null ? [] : [db.insert(agentDeploymentVersionsTable).values(version.values)]),
    db.delete(agentSkillsTable).where(eq(agentSkillsTable.agentId, existing.id)),
    ...(skillRows.length > 0 ? [db.insert(agentSkillsTable).values(skillRows)] : []),
  ]);

  return {
    agentRow: await getAgentRow(database, existing.id),
    changed: true,
    ...(version === null ? {} : { versionNumber: version.record.versionNumber }),
  };
}

async function prepareNativeRepoVersion(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: {
    agent: AgentRow;
    environmentId: AgentRow["environmentId"];
    skillIds: readonly SkillId[];
    sourceCommitSha: string | null;
    summary: string;
    timestampMs: number;
  },
): ReturnType<typeof prepareAgentDeploymentVersionCandidate> {
  const [specSkills, mcpBindings] = await Promise.all([
    listAgentSpecSkillsByIds(database, input.skillIds),
    listAgentSpecMcpBindings(database, input.agent.id),
  ]);
  const spec = await buildAgentSpecForPreparedProfile(database, {
    agent: input.agent,
    environment: { environmentId: input.environmentId },
    mcpBindings,
    skills: specSkills,
  });

  return prepareAgentDeploymentVersionCandidate(database, viewer, {
    agent: input.agent,
    sourceCommitSha: input.sourceCommitSha,
    spec,
    summary: input.summary,
    timestampMs: input.timestampMs,
  });
}

type NativeRepoPublishOutcome =
  | { kind: "published"; versionNumber?: number }
  | { issues: readonly string[]; kind: "setup" };

/**
 * Auto-publish gate. Readiness is checked first so setup work surfaces as a
 * structured repo-term outcome instead of a thrown API error; the catch is a
 * backstop for a readiness race inside `publishAgent` itself.
 */
async function publishNativeRepoAgent(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  agentRow: AgentRow,
  sourceCommitSha: string | null,
): Promise<NativeRepoPublishOutcome> {
  const database = bindings.DB;
  const environment = await loadAgentEnvironmentConfig(
    database,
    agentRow.id,
    agentRow.environmentId,
  );
  const { packageResolution } = parseAgentStoredConfig(agentRow.configJson);
  const readiness = await computeAgentReadiness(database, agentRow.ownerId, {
    agentId: agentRow.id,
    bindings,
    environment,
    model: agentRow.model,
    packageResolution,
    appId: agentRow.appId,
    provider: agentRow.provider,
    runtimeId: agentRow.runtimeId,
  });

  if (!readiness.ready) {
    return {
      issues: readiness.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message),
      kind: "setup",
    };
  }

  try {
    const published = await publishAgent(
      bindings,
      viewer,
      {
        agentId: agentRow.id,
        appId: agentRow.appId,
      },
      {
        sourceCommitSha,
      },
    );
    const versionNumber = published.liveVersion?.versionNumber;

    return {
      kind: "published",
      ...(versionNumber === undefined ? {} : { versionNumber }),
    };
  } catch (error) {
    if (isApiError(error) && error.code === API_ERROR_CODE.agentPublishNotReady) {
      return {
        issues: [stripPublishNotReadyPrefix(error.message)],
        kind: "setup",
      };
    }

    throw error;
  }
}

/**
 * Update-path skill resolution honoring existing repo-owned skills: a skill
 * whose package path matches one already carried by this agent is updated in
 * place (`updateOwnedSkillPackage`), never re-uploaded as a duplicate; new
 * package paths create new skills; non-package references bind existing App
 * skills by name.
 */
async function resolveNativeRepoUpdateSkills(input: {
  bindings: ApiBindings;
  existingPackageSkills: readonly AgentStoredPackageSkill[];
  issues: AgentResolutionIssue[];
  manifest: AgentManifest;
  packageAssets: readonly AgentPackageAsset[];
  appId: AppId;
  summary: AgentPackageResolutionSummary;
  viewer: AuthenticatedViewer;
}): Promise<PackageSkillResolution> {
  const packageSkills: AgentStoredPackageSkill[] = [];
  const skillIds: SkillId[] = [];
  const existingByPackagePath = new Map(
    input.existingPackageSkills.map((skill) => [skill.packagePath, skill]),
  );
  const accessibleSkills = await listAppSkillRows(input.bindings.DB, input.viewer.id, input.appId);
  const accessibleSkillsByName = new Map<string, (typeof accessibleSkills)[number]>();

  for (const skill of accessibleSkills) {
    const skillName = skill.name.toLowerCase();

    if (!accessibleSkillsByName.has(skillName)) {
      accessibleSkillsByName.set(skillName, skill);
    }
  }

  for (const [index, skill] of input.manifest.skills.entries()) {
    const packagePath = readNativeSkillPackagePath(skill.skillId);

    if (packagePath === null) {
      const matched = accessibleSkillsByName.get(skill.skillName.toLowerCase()) ?? null;

      if (matched === null) {
        pushMissingSkillIssue(input.issues, skill.skillName);
        continue;
      }

      skillIds.push(readSkillId(matched.id));
      input.summary.boundSkillCount += 1;
      continue;
    }

    const files = collectSkillFiles(input.packageAssets, packagePath);

    if (files === null) {
      pushMissingSkillIssue(input.issues, skill.skillName);
      continue;
    }

    const upload = {
      file: {
        bytes: zipSync(files),
        name: `${skill.skillName}.skill`,
      },
    };
    const existing = existingByPackagePath.get(packagePath) ?? null;
    const written =
      existing === null
        ? await createSkillFromUpload(input.bindings, input.viewer, input.appId, upload)
        : await updateOwnedSkillPackage(
            input.bindings,
            input.viewer,
            input.appId,
            existing.skillId,
            upload,
          );

    packageSkills.push({
      currentSnapshotId: readSkillSnapshotId(written.snapshotId, "Package skill snapshot ID"),
      ownerName: skill.ownerName,
      packagePath,
      skillId: readSkillId(written.id, "Package skill ID"),
      skillName: written.name,
      sortOrder: index,
    });
    input.summary.boundSkillCount += 1;
  }

  return { packageSkills, skillIds };
}

function collectSkillFiles(
  packageAssets: readonly AgentPackageAsset[],
  packagePath: string,
): Record<string, Uint8Array> | null {
  const files: Record<string, Uint8Array> = {};

  for (const asset of packageAssets) {
    if (asset.role !== "skill_file" || !asset.key.startsWith(packagePath)) {
      continue;
    }

    const relativePath = asset.key.slice(packagePath.length);

    if (!isTruthy(relativePath)) {
      continue;
    }

    files[relativePath] = asset.contentBytes ?? textEncoder.encode(asset.contentText ?? "");
  }

  if (!files["SKILL.md"]) {
    return null;
  }

  return files;
}

function readNativeSkillPackagePath(skillId: string): string | null {
  if (skillId.startsWith("package:")) {
    const packageName = skillId.slice("package:".length).trim();
    return isTruthy(packageName) ? `skills/${packageName}/` : null;
  }

  if (skillId.startsWith("skills/") && skillId.endsWith("/")) {
    return skillId;
  }

  return null;
}

function pushMissingSkillIssue(issues: AgentResolutionIssue[], skillName: string): void {
  issues.push({
    actionLabel: "Replace or remove skill",
    code: "agent.import.skill.missing",
    message: `Skill ${skillName} is not available in the target context.`,
    required: false,
    severity: "warning",
    status: "missing",
    targetLabel: skillName,
    targetType: "skill",
  });
}

/**
 * Normalizes Phase 0 validated repo agents into parsed `.agent` packages.
 * Pure; safe to call on any snapshot, but only green-validated repos are
 * guaranteed to normalize without failures.
 */
export function normalizeNativeRepoAgents(input: {
  agents: readonly NativeValidateAgentFact[];
  files: Readonly<Record<string, string>>;
}): NativeAgentNormalization[] {
  const entries = toArchiveEntries(input.files);

  return input.agents.map((fact) => normalizeNativeRepoAgent(fact, input.files, entries));
}

function normalizeNativeRepoAgent(
  fact: NativeValidateAgentFact,
  files: Readonly<Record<string, string>>,
  entries: Record<string, Uint8Array>,
): NativeAgentNormalization {
  const manifestPath =
    fact.source === "primary"
      ? PRIMARY_MANIFEST_PATH
      : `${NAMED_AGENT_DIR_PREFIX}${fact.name}/manifest.json`;
  const manifestJson = files[manifestPath];

  if (manifestJson === undefined) {
    return {
      manifestPath,
      name: fact.name,
      ok: false,
      problem: `manifest ${manifestPath} is missing from the repository snapshot`,
    };
  }

  try {
    const merged = mergeMcpSidecarJson(manifestJson, entries);
    const parsed = parseAgentPackageJson(rescopeNativeMcpCatalog(merged));

    if (parsed.package === null || parsed.manifest === null) {
      const problems = parsed.issues.map((issue) => issue.message).join(" ");

      return {
        manifestPath,
        name: fact.name,
        ok: false,
        problem: isTruthy(problems)
          ? problems
          : `manifest ${manifestPath} failed agent package validation`,
      };
    }

    const withEnvironment = attachEnvironmentDefinition(parsed.package, manifestJson, entries);
    const assets = readPackageAssets(withEnvironment, entries);

    return {
      agent: {
        exposed: fact.exposed,
        manifestPath,
        name: fact.name,
        package: attachAgentPackageAssets(withEnvironment, assets.assets),
      },
      ok: true,
    };
  } catch (error) {
    return {
      manifestPath,
      name: fact.name,
      ok: false,
      problem: errorMessage(error),
    };
  }
}

/**
 * Repo MCP catalogs declare `{enabled, name, ref}` and the shared sidecar
 * merge fills connection fields with a personal-scoped shape the package
 * reader rejects. Native MCP intent is app-scoped by definition, so entries
 * are rewritten to the app binding form before parsing; credentials still
 * never travel (needs_reconnect posture downstream).
 */
function rescopeNativeMcpCatalog(mergedManifestJson: string): string {
  const parsed: unknown = JSON.parse(mergedManifestJson);

  if (!isRecord(parsed) || !Array.isArray(parsed["mcpServers"])) {
    return mergedManifestJson;
  }

  const mcpServers = parsed["mcpServers"].map((entry) => {
    if (!isRecord(entry) || typeof entry["url"] !== "string") {
      return entry;
    }

    return {
      authType: entry["authType"] === "bearer" ? "bearer" : "oauth",
      credentialScope: "app",
      enabled: entry["enabled"] !== false,
      iconUrl: typeof entry["iconUrl"] === "string" ? entry["iconUrl"] : null,
      name: entry["name"],
      source: "app",
      url: entry["url"],
    };
  });

  return JSON.stringify({ ...parsed, mcpServers });
}

function toArchiveEntries(files: Readonly<Record<string, string>>): Record<string, Uint8Array> {
  const entries: Record<string, Uint8Array> = {};

  for (const [path, content] of Object.entries(files)) {
    if (path.startsWith(NATIVE_AGENT_DIR_PREFIX)) {
      entries[path.slice(NATIVE_AGENT_DIR_PREFIX.length)] = textEncoder.encode(content);
    }
  }

  return entries;
}

function mergeSkillIds(current: readonly SkillId[], resolved: readonly SkillId[]): SkillId[] {
  const merged = [...current];

  for (const skillId of resolved) {
    if (!merged.includes(skillId)) {
      merged.push(skillId);
    }
  }

  return merged;
}

function projectPackageSkill(skill: AgentStoredPackageSkill): Record<string, unknown> {
  return {
    currentSnapshotId: skill.currentSnapshotId,
    ownerName: skill.ownerName,
    packagePath: skill.packagePath,
    skillId: skill.skillId,
    skillName: skill.skillName,
    sortOrder: skill.sortOrder,
  };
}

function projectPackageMcpServer(server: AgentManifestMcpServerBinding): Record<string, unknown> {
  return {
    authType: server.authType,
    credentialScope: server.credentialScope,
    enabled: server.enabled,
    iconUrl: server.iconUrl,
    name: server.name,
    source: server.source,
    url: server.url,
  };
}

function toSetupFailureLine(agentName: string, issues: readonly string[]): string {
  const details = issues.length > 0 ? issues.join(" ") : "Setup is required before publish.";

  return `Agent "${agentName}" needs setup in App settings before its endpoint can activate: ${details}`;
}

const PUBLISH_NOT_READY_PREFIX = "Agent is not ready to publish: ";

function stripPublishNotReadyPrefix(message: string): string {
  return message.startsWith(PUBLISH_NOT_READY_PREFIX)
    ? message.slice(PUBLISH_NOT_READY_PREFIX.length)
    : "Setup is required before publish.";
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).toSorted(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }

  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? serialized : "undefined";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
