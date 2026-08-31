#!/usr/bin/env bun
import { DRIVER_PROTOCOL_VERSION } from "@mosoo/agent-driver/boot";
import { RUNTIME_EVENT_SCHEMA_VERSION } from "@mosoo/agent-driver/events";
import Cloudflare from "cloudflare";

import type { BunRuntime, BunSpawnSyncResult } from "../../../config/bun-script-types";
import { parseD1JsonResults } from "./d1-json";
import {
  acquireProdDeployLeaseStatements,
  assertProdDeployLeaseOwned,
  assertProdDeployLeaseReleased,
  releaseProdDeployLeaseStatements,
  verifyProdDeployLeaseStatements,
} from "./prod-deploy-lease";
import type { ProdSchemaCatalog } from "./prod-schema-guard";
import {
  assertProdSchemaMatches,
  createProdSchemaCatalogFromIntrospectionRows,
  createProdSchemaIntrospectionStatements,
  parseGeneratedProdSchemaCatalog,
} from "./prod-schema-guard";
import type {
  ProtocolV3ContainerApplication,
  ProtocolV3ContainerInstance,
  ProtocolV3CutoverState,
  ProtocolV3LegacyTerminalSourceInventory,
  ProtocolV3LossyMigrationInventory,
} from "./protocol-v3-cutover";
import {
  ACCEPT_PROTOCOL_V3_QUEUE_RESUME_SQL,
  assertCutoverMigrationJournalAudited,
  assertProtocolV3SmokeAgent,
  assertProtocolV3Release,
  assertProtocolV3WorkerVersion,
  assertProtocolV3LegacyTerminalIntegrity,
  assertProtocolV3LegacyTerminalSourceInventory,
  assertProtocolV3LossyMigrationInventory,
  assertProtocolV3RuntimeAuthorityPreflight,
  authorizeProtocolV3LegacyRewriteSql,
  beginProtocolV3MigrationSql,
  CLOSE_PROTOCOL_V3_SMOKE_WINDOW_SQL,
  collectProtocolV3ContainerApplications,
  collectProtocolV3ContainerInstances,
  completeProtocolV3QueueResume,
  ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL,
  ENTER_PROTOCOL_V3_DRAIN_SQL,
  ENTER_PROTOCOL_V3_QUEUES_RESUMING_SQL,
  findPendingProdMigrations,
  installProtocolV3PostMigrationCutoverSql,
  installProtocolV3CutoverSql,
  isProtocolV3ContainerRolloutConverged,
  isProtocolV3CutoverDrained,
  isProtocolV3RuntimeDrained,
  isProtocolV3SmokeReady,
  openProtocolV3SmokeWindowSql,
  parseProtocolV3CommandFreeze,
  parseProtocolV3ContainerManifestDigest,
  parseProtocolV3CutoverDrain,
  parseProtocolV3CutoverObjects,
  parseProtocolV3CutoverProbe,
  parseProtocolV3CutoverState,
  parseProtocolV3LegacyTerminalIntegrity,
  parseProtocolV3LegacyRewriteAuthorization,
  parseProtocolV3LegacyTerminalSourceInventory,
  parseProtocolV3LossyMigrationInventory,
  parseProtocolV3RuntimeAuthorityPreflight,
  parseProtocolV3SmokeStatus,
  parseCleanGitTreeOid,
  parseProtocolV3WorkerDeployment,
  parseStoredProtocolV3SmokeRequestKey,
  parseStoredProtocolV3SmokeSession,
  parseStoredProtocolV3CutoverBookmark,
  parseTimeTravelBookmark,
  PROD_APPLIED_MIGRATIONS_SQL,
  PROTOCOL_V3_CUTOVER_BOOKMARK_SQL,
  PROTOCOL_V3_CUTOVER_DRAIN_SQL,
  PROTOCOL_V3_CUTOVER_OBJECT_COUNT,
  PROTOCOL_V3_CUTOVER_OBJECTS_SQL,
  PROTOCOL_V3_CUTOVER_PROBE_SQL,
  PROTOCOL_V3_COMMAND_FREEZE_SQL,
  PROTOCOL_V3_LEGACY_TERMINAL_INTEGRITY_SQL,
  PROTOCOL_V3_LEGACY_TERMINAL_SOURCE_INVENTORY_SQL,
  PROTOCOL_V3_LEGACY_REWRITE_AUTHORIZATION_SQL,
  PROTOCOL_V3_LOSSY_MIGRATION_INVENTORY_SQL,
  PROTOCOL_V3_MIGRATION,
  PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT,
  PROTOCOL_V3_POST_MIGRATION_CUTOVER_DRAIN_SQL,
  PROTOCOL_V3_POST_MIGRATION_UNSAFE_SANDBOXES_SQL,
  PROTOCOL_V3_CUTOVER_QUEUE_NAMES,
  PROTOCOL_V3_RUNTIME_AUTHORITY_MIGRATION,
  PROTOCOL_V3_SESSION_CLEANUP_MIGRATION,
  PROTOCOL_V3_SESSION_EVENT_MIGRATION,
  recoverProtocolV3CutoverFailure,
  PROTOCOL_V3_SMOKE_REQUEST_KEY_SQL,
  PROTOCOL_V3_SMOKE_SESSION_SQL,
  PROTOCOL_V3_UNSAFE_SANDBOXES_SQL,
  protocolV3SmokeAgentSql,
  protocolV3SmokeStatusSql,
  protocolV3RuntimeAuthorityPreflightSql,
  protocolV3ReleaseTag,
  protocolV3ContainerImageTag,
  REMOVE_PROTOCOL_V3_CUTOVER_SQL,
  storeProtocolV3CutoverBookmarkSql,
  storeProtocolV3RolloutSql,
  storeProtocolV3SmokeRequestKeySql,
  storeProtocolV3SmokeSessionSql,
  updateAndVerifyProtocolV3QueueDelivery,
} from "./protocol-v3-cutover";

declare const Bun: BunRuntime;

const scriptDir = decodeURIComponent(new URL(".", import.meta.url).pathname).replace(/\/$/u, "");
const apiDir = `${scriptDir}/..`;
const repoRoot = `${apiDir}/../..`;
const D1_BINDING = "DB";
const ENV = "prod";
const EXPECTED_DRIVER_PROTOCOL_VERSION = 3;
const EXPECTED_RUNTIME_EVENT_SCHEMA_VERSION = "2026-08-29";
const PROD_CONTAINER_APPLICATION = "mosoo-api-prod-sandbox-prod";
const PROD_PUBLIC_API_URL = "https://cloud.mosoo.ai/api/v1";
const PROD_GRAPHQL_URL = "https://cloud.mosoo.ai/api/graphql";
const PROD_HEALTH_URL = "https://cloud.mosoo.ai/api/health?deep=1";
const CUTOVER_DRAIN_TIMEOUT_MS = 15 * 60 * 1_000;
const CUTOVER_ROLLOUT_TIMEOUT_MS = 10 * 60 * 1_000;
const CUTOVER_SMOKE_TIMEOUT_MS = 5 * 60 * 1_000;
const REMOTE_MUTATION_TIMEOUT_MS = 10 * 60 * 1_000;
const POLL_INTERVAL_MS = 5_000;
const PLATFORM_ID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/iu;
const CLOUDFLARE_ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/iu;
const WRANGLER_DISABLE_AUTO_PROVISION = "--experimental-provision=false";

function apiWorkerDryRunArgs(): string[] {
  return [
    "deploy",
    "--env",
    ENV,
    "--minify",
    "--strict",
    "--dry-run",
    WRANGLER_DISABLE_AUTO_PROVISION,
  ];
}

function apiWorkerDeployArgs(releaseTag: string): string[] {
  return [
    "deploy",
    "--env",
    ENV,
    "--minify",
    "--strict",
    WRANGLER_DISABLE_AUTO_PROVISION,
    "--containers-rollout",
    "immediate",
    "--tag",
    releaseTag,
  ];
}

function writeStdout(message: string): void {
  process.stdout.write(`${message}\n`);
}

const wranglerBin = `${apiDir}/node_modules/.bin/wrangler`;
const vpBin = `${repoRoot}/node_modules/.bin/vp`;

function run(args: string[], cwd = apiDir): void {
  const result = Bun.spawnSync([wranglerBin, ...args], {
    cwd,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(`wrangler ${args.join(" ")} exited with ${result.exitCode}.`);
  }
}

function runVp(args: string[], cwd = repoRoot): void {
  const result = Bun.spawnSync([vpBin, ...args], {
    cwd,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error(`vp ${args.join(" ")} exited with ${result.exitCode}.`);
  }
}

function captureGit(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: repoRoot });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} exited with ${result.exitCode}: ${result.stderr.toString("utf8")}`,
    );
  }
  return result.stdout.toString("utf8");
}

function readLocalMigrationNames(): string[] {
  return captureGit(["ls-files", "--", "pkgs/db/drizzle/*.sql"])
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((path) => path.slice("pkgs/db/drizzle/".length));
}

function readCleanReleaseTreeOid(): string {
  return parseCleanGitTreeOid(
    captureGit(["rev-parse", "HEAD^{tree}"]),
    captureGit(["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"]),
    `${captureGit(["ls-files", "-v"])}${captureGit([
      "submodule",
      "foreach",
      "--quiet",
      "--recursive",
      "git ls-files -v",
    ])}`,
    `${captureGit([
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--",
      ".env",
      ".env.*",
      ".dev.vars",
      ".dev.vars.*",
      "apps/api/.env",
      "apps/api/.env.*",
      "apps/api/.dev.vars",
      "apps/api/.dev.vars.*",
      "apps/web/.env",
      "apps/web/.env.*",
    ])}${captureGit([
      "submodule",
      "foreach",
      "--quiet",
      "--recursive",
      "git ls-files --others --ignored --exclude-standard -- .env .env.* .dev.vars .dev.vars.*",
    ])}`,
    Object.keys(process.env),
  );
}

function assertReleaseTreeUnchanged(releaseTreeOid: string): void {
  if (readCleanReleaseTreeOid() !== releaseTreeOid) {
    throw new Error("Production release tree changed during deployment.");
  }
}

function captureWrangler(args: string[], timeout?: number): string {
  const result = Bun.spawnSync([wranglerBin, ...args], {
    cwd: apiDir,
    ...(timeout === undefined ? {} : { timeout }),
  });
  const stdout = result.stdout.toString("utf8");
  const stderr = result.stderr.toString("utf8");

  if (result.exitCode !== 0) {
    throw new Error(
      `wrangler ${args.join(" ")} exited with ${result.exitCode}\nstderr: ${stderr}\nstdout: ${stdout}`,
    );
  }

  return stdout;
}

function readTaggedContainerImageDigest(
  application: ProtocolV3ContainerApplication,
  workerVersionId: string,
): string {
  const docker = process.env["WRANGLER_DOCKER_BIN"]?.trim() || "docker";
  const tag = protocolV3ContainerImageTag(application.imageRepository, workerVersionId);
  const result = Bun.spawnSync([docker, "manifest", "inspect", "-v", tag], {
    cwd: apiDir,
    timeout: 60_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `Container manifest inspection failed for ${tag}: ${result.stderr.toString("utf8")}`,
    );
  }
  return parseProtocolV3ContainerManifestDigest(result.stdout.toString("utf8"));
}

function executeRawProdD1Json(sql: string, timeout?: number): string {
  return captureWrangler(
    ["d1", "execute", D1_BINDING, "--remote", "--env", ENV, "--json", "--command", sql],
    timeout,
  );
}

let prodDeployLeaseOwner: string | null = null;

function executeProdDeployLease(statements: readonly string[]): string {
  return executeRawProdD1Json(`${statements.join(";\n")};`, REMOTE_MUTATION_TIMEOUT_MS);
}

function executeIdempotentProdDeployLeaseWithRetry(statements: readonly string[]): string {
  try {
    return executeProdDeployLease(statements);
  } catch {
    return executeProdDeployLease(statements);
  }
}

function executeOwnedProdDeployLease(statements: readonly string[], owner: string): void {
  assertProdDeployLeaseOwned(executeIdempotentProdDeployLeaseWithRetry(statements), owner);
}

export function acquireProdDeployLease(
  owner: string,
  execute: (statements: readonly string[]) => string,
): void {
  assertProdDeployLeaseOwned(execute(acquireProdDeployLeaseStatements(owner)), owner);
  prodDeployLeaseOwner = owner;
}

function verifyProdDeployLease(): void {
  if (prodDeployLeaseOwner === null) {
    throw new Error("Production remote mutation requires an acquired deploy lease.");
  }
  executeOwnedProdDeployLease(verifyProdDeployLeaseStatements(), prodDeployLeaseOwner);
}

function releaseProdDeployLease(): void {
  if (prodDeployLeaseOwner === null) return;
  const owner = prodDeployLeaseOwner;
  try {
    assertProdDeployLeaseReleased(
      executeIdempotentProdDeployLeaseWithRetry(releaseProdDeployLeaseStatements(owner)),
    );
  } finally {
    prodDeployLeaseOwner = null;
  }
}

function executeProdMutation(args: string[], inheritOutput = false): BunSpawnSyncResult {
  verifyProdDeployLease();
  let result: BunSpawnSyncResult;
  try {
    result = Bun.spawnSync([wranglerBin, ...args], {
      cwd: apiDir,
      ...(inheritOutput
        ? { stderr: "inherit" as const, stdin: "inherit" as const, stdout: "inherit" as const }
        : {}),
      timeout: REMOTE_MUTATION_TIMEOUT_MS,
    });
  } catch (mutationError) {
    try {
      verifyProdDeployLease();
    } catch (verificationError) {
      throw new AggregateError(
        [mutationError, verificationError],
        "Production mutation and deploy lease verification both failed.",
        { cause: verificationError },
      );
    }
    throw mutationError;
  }
  let verificationError: unknown = null;
  try {
    verifyProdDeployLease();
  } catch (error) {
    verificationError = error;
  }
  if (verificationError !== null) {
    throw new AggregateError(
      [
        new Error(
          `wrangler ${args.join(" ")} completed with ${result.exitCode} before deploy lease verification failed.`,
        ),
        verificationError,
      ],
      "Production mutation ownership could not be verified.",
    );
  }
  return result;
}

function runProdMutation(args: string[]): void {
  const result = executeProdMutation(args, true);
  if (result.exitCode !== 0) {
    throw new Error(`wrangler ${args.join(" ")} exited with ${result.exitCode}.`);
  }
}

async function runOwnedProdAsyncMutation<T>(mutation: () => Promise<T>): Promise<T> {
  verifyProdDeployLease();
  let result: T;
  try {
    result = await mutation();
  } catch (mutationError) {
    try {
      verifyProdDeployLease();
    } catch (verificationError) {
      throw new AggregateError(
        [mutationError, verificationError],
        "Production mutation and deploy lease verification both failed.",
        { cause: verificationError },
      );
    }
    throw mutationError;
  }
  try {
    verifyProdDeployLease();
  } catch (verificationError) {
    throw new AggregateError(
      [
        new Error("Cloudflare mutation completed before deploy lease verification failed."),
        verificationError,
      ],
      "Production mutation ownership could not be verified.",
      { cause: verificationError },
    );
  }
  return result;
}

function executeProdD1Json(sql: string): string {
  return executeRawProdD1Json(sql);
}

function executeProdD1(sql: string): void {
  runProdMutation([
    "d1",
    "execute",
    D1_BINDING,
    "--remote",
    "--env",
    ENV,
    "--yes",
    "--command",
    sql,
  ]);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function applyD1Migrations(): void {
  runProdMutation(["d1", "migrations", "apply", D1_BINDING, "--remote", "--env", ENV]);
}

function loadExpectedProdSchema(): ProdSchemaCatalog {
  const result = Bun.spawnSync(["bun", "pkgs/db/scripts/check-schema.ts", "--catalog"], {
    cwd: repoRoot,
  });
  const stdout = result.stdout.toString("utf8");
  const stderr = result.stderr.toString("utf8");

  if (result.exitCode !== 0) {
    throw new Error(
      `Drizzle schema freshness check exited with ${result.exitCode}\nstderr: ${stderr}\nstdout: ${stdout}`,
    );
  }
  return parseGeneratedProdSchemaCatalog(stdout);
}

function assertProdSchemaMatchesSnapshot(expected: ProdSchemaCatalog): void {
  const tableNames = expected.tables.map(({ name }) => name);
  const statements = createProdSchemaIntrospectionStatements(tableNames);
  const live = createProdSchemaCatalogFromIntrospectionRows(
    parseD1JsonResults(executeProdD1Json(statements.join(";\n"))),
    tableNames,
  );
  assertProdSchemaMatches(expected, live);
  writeStdout(`  prod schema OK (${expected.tables.length} tables fully match)`);
}

function listProdQueues(): string[] {
  const result = Bun.spawnSync([wranglerBin, "queues", "list"], { cwd: apiDir });
  const stdout = result.stdout.toString("utf8");
  const stderr = result.stderr.toString("utf8");

  if (result.exitCode !== 0) {
    throw new Error(
      `wrangler queues list exited with ${result.exitCode}\nstderr: ${stderr}\nstdout: ${stdout}`,
    );
  }

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineContainsQueueName(line: string, queueName: string): boolean {
  return new RegExp(`(^|[^\\w-])${escapeRegExp(queueName)}([^\\w-]|$)`).test(line);
}

function ensureQueueExists(queueName: string, existingQueues: readonly string[]): void {
  if (existingQueues.some((line) => lineContainsQueueName(line, queueName))) {
    writeStdout(`  queue ${queueName} already exists`);
    return;
  }

  const result = executeProdMutation(["queues", "create", queueName]);
  const stdout = result.stdout.toString("utf8");
  const stderr = result.stderr.toString("utf8");

  if (result.exitCode === 0) {
    writeStdout(`  created queue ${queueName}`);
    return;
  }

  const combined = `${stderr}\n${stdout}`.toLowerCase();
  if (combined.includes("already exists")) {
    writeStdout(`  queue ${queueName} already exists`);
    return;
  }

  throw new Error(
    `wrangler queues create ${queueName} exited with ${result.exitCode}\nstderr: ${stderr}\nstdout: ${stdout}`,
  );
}

function ensureRequiredProdQueues(): void {
  const listing = listProdQueues();
  for (const queueName of PROTOCOL_V3_CUTOVER_QUEUE_NAMES) {
    ensureQueueExists(queueName, listing);
  }
}

function assertProtocolV3Artifacts(): void {
  const protocolVersion: number = DRIVER_PROTOCOL_VERSION;
  const eventSchemaVersion: string = RUNTIME_EVENT_SCHEMA_VERSION;

  if (
    protocolVersion !== EXPECTED_DRIVER_PROTOCOL_VERSION ||
    eventSchemaVersion !== EXPECTED_RUNTIME_EVENT_SCHEMA_VERSION
  ) {
    throw new Error(
      `Production requires Driver protocol ${EXPECTED_DRIVER_PROTOCOL_VERSION} and event schema ${EXPECTED_RUNTIME_EVENT_SCHEMA_VERSION}; got ${protocolVersion} and ${eventSchemaVersion}.`,
    );
  }
}

function runLocalPreflight(releaseTreeOid: string): void {
  assertProtocolV3Artifacts();

  writeStdout("▶ Building Driver before any production mutation");
  runVp(["run", "--filter", "agent-driver", "build"]);

  writeStdout("▶ Dry-running the API Worker before any production mutation");
  run(apiWorkerDryRunArgs());

  assertReleaseTreeUnchanged(releaseTreeOid);
}

interface ProtocolV3SmokeConfig {
  readonly agentId: string;
  readonly token: string;
}

interface ProdQueueApiConfig {
  readonly accountId: string;
  readonly apiToken: string;
}

function readProdQueueApiConfig(): ProdQueueApiConfig {
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"]?.trim() ?? "";
  const apiToken = process.env["CLOUDFLARE_API_TOKEN"]?.trim() ?? "";

  if (!CLOUDFLARE_ACCOUNT_ID_PATTERN.test(accountId) || !apiToken) {
    throw new Error(
      "Production deploy requires exact CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN values.",
    );
  }

  return { accountId, apiToken };
}

function readProtocolV3SmokeConfig(): ProtocolV3SmokeConfig {
  const agentId = process.env["MOSOO_PROTOCOL_V3_SMOKE_AGENT_ID"]?.trim() ?? "";
  const token = process.env["MOSOO_PROTOCOL_V3_SMOKE_TOKEN"]?.trim() ?? "";

  if (!PLATFORM_ID_PATTERN.test(agentId) || !token) {
    throw new Error(
      "Production deploy requires a dedicated MOSOO_PROTOCOL_V3_SMOKE_AGENT_ID and MOSOO_PROTOCOL_V3_SMOKE_TOKEN.",
    );
  }

  return { agentId, token };
}

function probeProtocolV3Cutover() {
  return parseProtocolV3CutoverProbe(executeProdD1Json(PROTOCOL_V3_CUTOVER_PROBE_SQL));
}

function readPendingProdMigrations(localMigrationNames: readonly string[]): string[] {
  return findPendingProdMigrations(
    executeProdD1Json(PROD_APPLIED_MIGRATIONS_SQL),
    localMigrationNames,
  );
}

function printProtocolV3LossyMigrationInventory(
  inventory: ProtocolV3LossyMigrationInventory,
): void {
  writeStdout(
    `  migration 0014 loss candidates: total=${inventory.totalCandidates} orphan_effects=${inventory.orphanEffects} attempt_completion_time_fabrications=${inventory.attemptCompletionTimeFabrications} command_payload_conflicts=${inventory.commandPayloadConflicts} MCP_arguments=${inventory.mcpArgumentOmissions} input_text=${inventory.inputTextOmissions} input_results=${inventory.inputStartResultOmissions} control_reason=${inventory.controlReasonOmissions} permission_payload_rewrites=${inventory.permissionPayloadRewrites} MCP_result_omissions=${inventory.mcpResultOmissions} MCP_result_conflicts=${inventory.mcpResultConflicts} provider_receipts=${inventory.providerReceiptLosses} MCP_terminal_conflicts=${inventory.mcpCommandTerminalConflicts} command_errors=${inventory.commandErrorOmissions} Session_Run_errors=${inventory.sessionRunErrorOmissions}`,
  );
  for (const candidate of inventory.candidateIds) {
    writeStdout(`  ${candidate.category}: ${candidate.id}`);
  }
  if (inventory.totalCandidates > inventory.candidateIds.length) {
    writeStdout(
      `  ... ${inventory.totalCandidates - inventory.candidateIds.length} more candidates`,
    );
  }
}

function verifyProdLossyMigrationInventory(): void {
  const inventory = parseProtocolV3LossyMigrationInventory(
    executeProdD1Json(PROTOCOL_V3_LOSSY_MIGRATION_INVENTORY_SQL),
  );
  printProtocolV3LossyMigrationInventory(inventory);
  assertProtocolV3LossyMigrationInventory(inventory);
}

function printProtocolV3LegacyTerminalSourceInventory(
  inventory: ProtocolV3LegacyTerminalSourceInventory,
): void {
  for (const [kind, counts] of [
    ["cancelled", inventory.cancelled],
    ["completed", inventory.completed],
    ["failed", inventory.failed],
  ] as const) {
    writeStdout(
      `  run.${kind}: total=${counts.total} canonical=${counts.canonical} rewrite_candidates=${counts.noncanonical} canonical_target_collisions=${counts.canonicalTargetCollisions}`,
    );
  }
  writeStdout(
    `  invalid terminal links=${inventory.invalidTerminalLinks} status/kind mismatches=${inventory.mismatchedTerminalEvents} multiple terminal Runs=${inventory.multipleTerminalRuns}`,
  );
}

function verifyProdLegacyTerminalSourceInventory(): void {
  const inventory = parseProtocolV3LegacyTerminalSourceInventory(
    executeProdD1Json(PROTOCOL_V3_LEGACY_TERMINAL_SOURCE_INVENTORY_SQL),
  );
  printProtocolV3LegacyTerminalSourceInventory(inventory);
  assertProtocolV3LegacyTerminalSourceInventory(inventory);
}

interface LegacyRewriteProof {
  readonly candidateCount: number;
  readonly candidateManifestJson: string;
}

function preflightProdLegacyTerminalIntegrity(): LegacyRewriteProof {
  verifyProdLegacyTerminalSourceInventory();

  const integrity = parseProtocolV3LegacyTerminalIntegrity(
    executeProdD1Json(PROTOCOL_V3_LEGACY_TERMINAL_INTEGRITY_SQL),
  );
  assertProtocolV3LegacyTerminalIntegrity(integrity);
  writeStdout(
    `  legacy terminal integrity is unambiguous; migration 0015 will normalize ${integrity.noncanonicalTerminalSources} terminal source identities and ${integrity.repairableFailedRuns} failed Run errors, label ${integrity.legacyMaterializedMessages} messages as materialized, backfill ${integrity.legacyStreamRows} row-local stream identities, and preserve ${integrity.legacyTerminalEvents} terminal events as semantic_hash=NULL legacy history`,
  );
  return {
    candidateCount: integrity.noncanonicalTerminalSources,
    candidateManifestJson: integrity.rewriteCandidateManifestJson,
  };
}

function authorizeProdLegacyTerminalRewrite(
  proof: LegacyRewriteProof,
  releaseTreeOid: string,
  bookmark: string,
): void {
  if (prodDeployLeaseOwner === null) {
    throw new Error("Protocol v3 legacy rewrite requires the production deploy lease.");
  }
  const owner = prodDeployLeaseOwner;
  executeProdD1(
    authorizeProtocolV3LegacyRewriteSql(owner, proof.candidateCount, proof.candidateManifestJson),
  );
  const authorization = parseProtocolV3LegacyRewriteAuthorization(
    executeProdD1Json(PROTOCOL_V3_LEGACY_REWRITE_AUTHORIZATION_SQL),
  );
  if (
    authorization.deployOwner !== owner ||
    authorization.bookmark !== bookmark ||
    authorization.candidateCount !== proof.candidateCount ||
    authorization.candidateManifestJson !== proof.candidateManifestJson ||
    authorization.releaseTreeOid !== releaseTreeOid ||
    authorization.expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    throw new Error("Protocol v3 legacy rewrite authorization did not persist exactly.");
  }
}

function readProtocolV3CutoverState(): ProtocolV3CutoverState {
  return parseProtocolV3CutoverState(executeProdD1Json(PROTOCOL_V3_COMMAND_FREEZE_SQL));
}

function installProtocolV3CutoverGate(
  releaseTreeOid: string,
  postRuntimeAuthorityMigration: boolean,
): ProtocolV3CutoverState {
  executeProdD1(
    postRuntimeAuthorityMigration
      ? installProtocolV3PostMigrationCutoverSql(releaseTreeOid)
      : installProtocolV3CutoverSql(releaseTreeOid),
  );
  assertProtocolV3CutoverGateExact();
  const state = readProtocolV3CutoverState();
  assertProtocolV3Release(state, releaseTreeOid);
  return state;
}

function assertProtocolV3CutoverGateExact(): void {
  const objects = parseProtocolV3CutoverObjects(executeProdD1Json(PROTOCOL_V3_CUTOVER_OBJECTS_SQL));

  const validCount =
    objects.objectCount === PROTOCOL_V3_CUTOVER_OBJECT_COUNT ||
    objects.objectCount === PROTOCOL_V3_POST_MIGRATION_CUTOVER_OBJECT_COUNT;
  if (!validCount || objects.exactObjectCount !== objects.objectCount) {
    throw new Error(
      `Protocol v3 cutover gate is invalid (${objects.objectCount} observed, ${objects.exactObjectCount} exact objects).`,
    );
  }
}

function removeProtocolV3CutoverGate(): void {
  executeProdD1(REMOVE_PROTOCOL_V3_CUTOVER_SQL);
  const objects = parseProtocolV3CutoverObjects(executeProdD1Json(PROTOCOL_V3_CUTOVER_OBJECTS_SQL));
  if (objects.objectCount !== 0 || probeProtocolV3Cutover().gatePresent) {
    throw new Error(
      `Protocol v3 cutover gate cleanup is incomplete (${objects.objectCount} reserved objects remain).`,
    );
  }
}

function enableProtocolV3CommandFreeze(): void {
  executeProdD1(ENABLE_PROTOCOL_V3_COMMAND_FREEZE_SQL);
  if (!parseProtocolV3CommandFreeze(executeProdD1Json(PROTOCOL_V3_COMMAND_FREEZE_SQL))) {
    throw new Error("Protocol v3 final Driver command freeze was not enabled.");
  }
}

function beginProtocolV3Migration(releaseTreeOid: string): ProtocolV3CutoverState {
  executeProdD1(beginProtocolV3MigrationSql(releaseTreeOid));
  const state = readProtocolV3CutoverState();
  if (!state.migrationStarted) {
    throw new Error("Protocol v3 migration intent did not persist exactly.");
  }
  return state;
}

function enterProtocolV3QueuesResuming(): ProtocolV3CutoverState {
  executeProdD1(ENTER_PROTOCOL_V3_QUEUES_RESUMING_SQL);
  const state = readProtocolV3CutoverState();
  if (state.phase !== "queues_resuming" || !state.enabled || !state.commandFreeze) {
    throw new Error("Protocol v3 queue-resume recovery phase was not persisted.");
  }
  return state;
}

function acceptProtocolV3QueueResume(): void {
  executeProdD1(ACCEPT_PROTOCOL_V3_QUEUE_RESUME_SQL);
  const state = readProtocolV3CutoverState();
  if (state.phase !== "queues_resuming" || state.enabled || !state.commandFreeze) {
    throw new Error("Protocol v3 queue-resume acceptance was not persisted.");
  }
}

function enterProtocolV3Drain(): void {
  executeProdD1(ENTER_PROTOCOL_V3_DRAIN_SQL);
  if (parseProtocolV3CommandFreeze(executeProdD1Json(PROTOCOL_V3_COMMAND_FREEZE_SQL))) {
    throw new Error("Protocol v3 drain gate did not keep control commands available.");
  }
}

async function updateAndVerifyProdQueues(
  config: ProdQueueApiConfig,
  action: "pause" | "resume",
): Promise<void> {
  const client = new Cloudflare({ apiToken: config.apiToken });
  const queues: Array<{ id: string; name: string }> = [];

  for await (const queue of client.queues.list({ account_id: config.accountId })) {
    if (queue.queue_name && queue.queue_id) {
      queues.push({ id: queue.queue_id, name: queue.queue_name });
    }
  }

  await updateAndVerifyProtocolV3QueueDelivery(
    {
      list: async () => queues,
      mutate: (queueName, queueAction) => {
        runProdMutation(["queues", `${queueAction}-delivery`, queueName]);
      },
      read: async (queueId) => {
        const queue = await client.queues.get(queueId, { account_id: config.accountId });
        return {
          deliveryPaused: queue.settings?.delivery_paused,
          name: queue.queue_name ?? "",
        };
      },
    },
    action,
  );
  for (const queueName of PROTOCOL_V3_CUTOVER_QUEUE_NAMES) {
    writeStdout(`  queue ${queueName} delivery is ${action}d`);
  }
}

function resumeAndVerifyProdQueues(config: ProdQueueApiConfig): Promise<void> {
  return updateAndVerifyProdQueues(config, "resume");
}

function pauseAndVerifyProdQueues(config: ProdQueueApiConfig): Promise<void> {
  return updateAndVerifyProdQueues(config, "pause");
}

async function waitForProtocolV3Drain(
  postRuntimeAuthorityMigration: boolean,
  requireCommands = true,
): Promise<void> {
  const deadline = Date.now() + CUTOVER_DRAIN_TIMEOUT_MS;

  while (true) {
    const state = parseProtocolV3CutoverDrain(
      executeProdD1Json(
        postRuntimeAuthorityMigration
          ? PROTOCOL_V3_POST_MIGRATION_CUTOVER_DRAIN_SQL
          : PROTOCOL_V3_CUTOVER_DRAIN_SQL,
      ),
    );

    writeStdout(
      `  drain: runs=${state.activeRuns} retiredProjectDeploymentRuns=${state.activeAppDeploymentRuns} drivers=${state.liveDrivers} effects=${state.unsettledEffects} driverCommands=${state.nonterminalCommands} apiCommands=${state.nonterminalApiCommands} sandboxes=${state.unsafeSandboxes} sandboxSessions=${state.unsafeSandboxSessions} backups=${state.unsafeSandboxBackups} backupStaging=${state.unsafeSandboxBackupStaging} environmentArtifactStaging=${state.unsafeEnvironmentArtifactBackupStaging} sessions=${state.unsafeSessions}`,
    );
    if (requireCommands ? isProtocolV3CutoverDrained(state) : isProtocolV3RuntimeDrained(state)) {
      return;
    }
    if (Date.now() >= deadline) {
      const unsafeSandboxes = parseD1JsonResults(
        executeProdD1Json(
          postRuntimeAuthorityMigration
            ? PROTOCOL_V3_POST_MIGRATION_UNSAFE_SANDBOXES_SQL
            : PROTOCOL_V3_UNSAFE_SANDBOXES_SQL,
        ),
      )
        .flatMap((rows) => rows)
        .map((row) => `${String(row.id)}(${String(row.status)})`)
        .join(", ");
      throw new Error(
        `Protocol v3 ${requireCommands ? "final command" : "runtime"} drain did not finish before the 15-minute safety timeout.${unsafeSandboxes.length === 0 ? "" : ` Unsafe sandboxes: ${unsafeSandboxes}. Use the supported lifecycle hibernate/checkpoint path, then retry.`}`,
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

function readStoredProtocolV3Bookmark(): string | null {
  return parseStoredProtocolV3CutoverBookmark(executeProdD1Json(PROTOCOL_V3_CUTOVER_BOOKMARK_SQL));
}

function printProtocolV3EmergencyBookmark(bookmark: string): void {
  writeStdout(`  emergency destructive backup bookmark: ${bookmark}`);
  writeStdout(
    "  After migration, automated recovery is roll-forward only: rerun this exact v3 release.",
  );
  writeStdout(
    "  D1 Time Travel would discard every D1 write after this bookmark and does not restore Durable Object storage.",
  );
  writeStdout(
    "  Manual v2 recovery requires a global maintenance write stop, a reconciled inventory of post-bookmark writes, and explicit human approval.",
  );
}

function readExactProdWorkerVersion(releaseTreeOid: string): string {
  const deployment = parseProtocolV3WorkerDeployment(
    captureWrangler(["deployments", "status", "--env", ENV, "--json"]),
  );
  assertProtocolV3WorkerVersion(
    captureWrangler(["versions", "view", deployment.versionId, "--env", ENV, "--json"]),
    deployment.versionId,
    releaseTreeOid,
  );
  return deployment.versionId;
}

function ensureProtocolV3Bookmark(): string {
  const stored = readStoredProtocolV3Bookmark();
  if (stored !== null) return stored;

  const bookmark = parseTimeTravelBookmark(
    captureWrangler(["d1", "time-travel", "info", D1_BINDING, "--env", ENV, "--json"]),
  );
  executeProdD1(storeProtocolV3CutoverBookmarkSql(bookmark));
  const persisted = readStoredProtocolV3Bookmark();

  if (persisted !== bookmark) {
    throw new Error(
      "Failed to persist the pre-migration Time Travel bookmark in the cutover gate.",
    );
  }

  return bookmark;
}

async function readProdContainerApplication(
  config: ProdQueueApiConfig,
): Promise<ProtocolV3ContainerApplication> {
  const client = new Cloudflare({ apiToken: config.apiToken });
  const applications = await collectProtocolV3ContainerApplications((pageToken) =>
    client.get<unknown>(`/accounts/${config.accountId}/containers/dash/applications`, {
      query: {
        per_page: 100,
        ...(pageToken === null ? {} : { page_token: pageToken }),
      },
      timeout: 10_000,
    }),
  );
  const matches = applications.filter(
    (application) => application.name === PROD_CONTAINER_APPLICATION,
  );
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one Container application ${PROD_CONTAINER_APPLICATION}; found ${matches.length}.`,
    );
  }
  return matches[0];
}

function readProdContainerInstances(applicationId: string): Promise<ProtocolV3ContainerInstance[]> {
  return collectProtocolV3ContainerInstances((pageToken) =>
    captureWrangler([
      "containers",
      "instances",
      applicationId,
      "--json",
      "--per-page",
      "100",
      ...(pageToken === null ? [] : ["--page-token", pageToken]),
      "--env",
      ENV,
    ]),
  );
}

async function waitForContainerRollout(
  config: ProdQueueApiConfig,
  expectedImageDigest: string,
  previousVersion: number,
  expectedVersion: number | null,
): Promise<ProtocolV3ContainerApplication> {
  const deadline = Date.now() + CUTOVER_ROLLOUT_TIMEOUT_MS;

  while (true) {
    const application = await readProdContainerApplication(config);
    const instances = await readProdContainerInstances(application.id);

    if (expectedVersion !== null && application.version !== expectedVersion) {
      throw new Error(
        `Production Container application moved from release version ${expectedVersion} to ${application.version}.`,
      );
    }
    if (
      expectedVersion === null &&
      (application.version < previousVersion || application.version > previousVersion + 1)
    ) {
      throw new Error("Production Container application advanced outside this release rollout.");
    }
    if (
      application.imageDigest !== expectedImageDigest &&
      application.version !== previousVersion
    ) {
      throw new Error("Production Container application advanced to a foreign image.");
    }

    if (
      application.imageDigest === expectedImageDigest &&
      isProtocolV3ContainerRolloutConverged(application, instances)
    ) {
      writeStdout(
        `  container rollout converged at application version ${application.version} (${instances.length} known instances)`,
      );
      return application;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "Protocol v3 Container rollout did not converge before the 10-minute timeout.",
      );
    }

    writeStdout(
      `  waiting for ${instances.length} Container instances to reach the target version`,
    );
    await sleep(POLL_INTERVAL_MS);
  }
}

async function assertPublishedProtocolV3Release(
  state: ProtocolV3CutoverState,
  releaseTreeOid: string,
  config: ProdQueueApiConfig,
): Promise<void> {
  assertProtocolV3Release(state, releaseTreeOid);
  if (
    state.workerVersionId === null ||
    state.containerApplicationVersion === null ||
    state.containerImageDigest === null
  ) {
    throw new Error("Protocol v3 rollout metadata is not durably bound to the cutover marker.");
  }
  if (readExactProdWorkerVersion(releaseTreeOid) !== state.workerVersionId) {
    throw new Error("Production Worker moved away from the bound protocol v3 version.");
  }
  const application = await readProdContainerApplication(config);
  if (
    application.version !== state.containerApplicationVersion ||
    application.imageDigest !== state.containerImageDigest ||
    readTaggedContainerImageDigest(application, state.workerVersionId) !==
      state.containerImageDigest
  ) {
    throw new Error(
      "Production Container application moved away from the bound protocol v3 version.",
    );
  }
}

async function verifyProdHealth(): Promise<void> {
  let lastError: unknown = new Error("Production health check was not attempted.");

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(PROD_HEALTH_URL, { signal: AbortSignal.timeout(10_000) });
      const body = (await response.json()) as { name?: unknown; ok?: unknown };

      if (response.ok && body.name === "mosoo" && body.ok === true) {
        writeStdout("  production Worker and D1 health check passed");
        return;
      }

      lastError = new Error(`health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < 12) await sleep(POLL_INTERVAL_MS);
  }

  throw new Error("Production health check failed after deployment.", { cause: lastError });
}

function requireJsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

async function fetchProdMutation(input: string, init: RequestInit): Promise<Response> {
  return runOwnedProdAsyncMutation(() =>
    fetch(input, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(REMOTE_MUTATION_TIMEOUT_MS),
    }),
  );
}

async function fetchProtocolV3SmokeJson(
  config: ProtocolV3SmokeConfig,
  path: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${config.token}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");

  const response = await fetchProdMutation(`${PROD_PUBLIC_API_URL}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const body = requireJsonRecord(await response.json(), "Protocol v3 smoke response");

  if (!response.ok) {
    throw new Error(
      `Protocol v3 smoke ${init.method ?? "GET"} ${path} returned HTTP ${response.status}.`,
    );
  }

  return body;
}

async function readProtocolV3SmokeAccountId(config: ProtocolV3SmokeConfig): Promise<string> {
  const response = await fetch(PROD_GRAPHQL_URL, {
    body: JSON.stringify({ query: "query ProtocolV3SmokeViewer { viewer { account { id } } }" }),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  });
  const body = requireJsonRecord(await response.json(), "Protocol v3 smoke viewer response");

  if (!response.ok || (Array.isArray(body.errors) && body.errors.length > 0)) {
    throw new Error(`Protocol v3 smoke viewer query returned HTTP ${response.status}.`);
  }

  const data = requireJsonRecord(body.data, "Protocol v3 smoke viewer data");
  const viewer = requireJsonRecord(data.viewer, "Protocol v3 smoke viewer");
  const account = requireJsonRecord(viewer.account, "Protocol v3 smoke account");
  const accountId = account.id;

  if (typeof accountId !== "string" || !PLATFORM_ID_PATTERN.test(accountId)) {
    throw new Error("Protocol v3 smoke PAT did not resolve to a valid account ID.");
  }

  return accountId;
}

async function createProtocolV3SmokeThread(
  config: ProtocolV3SmokeConfig,
  idempotencyKey: string,
): Promise<string> {
  let lastError: unknown = new Error("Protocol v3 smoke create was not attempted.");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const body = await fetchProtocolV3SmokeJson(
        config,
        `/agents/${encodeURIComponent(config.agentId)}/threads`,
        {
          body: JSON.stringify({ userId: idempotencyKey }),
          headers: { "Idempotency-Key": idempotencyKey },
          method: "POST",
        },
      );
      const thread = requireJsonRecord(body.thread, "Protocol v3 smoke Thread");
      const threadId = thread.id;

      if (body.run !== null) {
        throw new Error("Protocol v3 empty smoke Thread unexpectedly created a Run.");
      }
      if (typeof threadId !== "string" || !PLATFORM_ID_PATTERN.test(threadId)) {
        throw new Error("Protocol v3 smoke create response is missing a valid Thread ID.");
      }

      return threadId;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(POLL_INTERVAL_MS);
    }
  }

  throw new Error("Protocol v3 smoke Thread creation failed after idempotent retries.", {
    cause: lastError,
  });
}

async function waitForProtocolV3SmokeReady(sessionId: string): Promise<void> {
  const deadline = Date.now() + CUTOVER_SMOKE_TIMEOUT_MS;

  while (true) {
    const status = parseProtocolV3SmokeStatus(
      executeProdD1Json(protocolV3SmokeStatusSql(sessionId)),
    );

    if (isProtocolV3SmokeReady(status)) {
      writeStdout(
        `  live Driver ${status.driverVersion} completed protocol v3 boot, hello, and ready`,
      );
      return;
    }
    if (status.driverStatus === "failed" || status.driverStatus === "stopped") {
      throw new Error(
        `Protocol v3 smoke Driver became ${status.driverStatus} before completing hello and ready.`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error("Protocol v3 live Driver smoke did not reach ready within five minutes.");
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function deleteProtocolV3SmokeThread(
  config: ProtocolV3SmokeConfig,
  threadId: string,
): Promise<void> {
  let lastError: unknown = new Error("Protocol v3 smoke cleanup was not attempted.");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchProdMutation(
        `${PROD_PUBLIC_API_URL}/threads/${encodeURIComponent(threadId)}`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${config.token}`,
          },
          method: "DELETE",
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (response.ok || response.status === 404) return;
      throw new Error(`Protocol v3 smoke DELETE returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(POLL_INTERVAL_MS);
    }
  }

  throw new Error(`Protocol v3 smoke Thread ${threadId} cleanup failed after retries.`, {
    cause: lastError,
  });
}

function readStoredProtocolV3SmokeSession(): string | null {
  return parseStoredProtocolV3SmokeSession(executeProdD1Json(PROTOCOL_V3_SMOKE_SESSION_SQL));
}

function readStoredProtocolV3SmokeRequestKey(): string | null {
  return parseStoredProtocolV3SmokeRequestKey(executeProdD1Json(PROTOCOL_V3_SMOKE_REQUEST_KEY_SQL));
}

async function cleanInterruptedProtocolV3Smoke(config: ProtocolV3SmokeConfig): Promise<void> {
  let sessionId = readStoredProtocolV3SmokeSession();
  const requestKey = readStoredProtocolV3SmokeRequestKey();

  if (sessionId === null && requestKey !== null) {
    writeStdout(`  recovering interrupted protocol v3 smoke request ${requestKey}`);
    sessionId = await createProtocolV3SmokeThread(config, requestKey);
    executeProdD1(storeProtocolV3SmokeSessionSql(sessionId));
  }
  if (sessionId === null) return;

  writeStdout(`  cleaning interrupted protocol v3 smoke Session ${sessionId}`);
  await deleteProtocolV3SmokeThread(config, sessionId);
  executeProdD1(CLOSE_PROTOCOL_V3_SMOKE_WINDOW_SQL);
}

async function runProtocolV3LiveSmoke(
  config: ProtocolV3SmokeConfig,
  closedGate: boolean,
): Promise<void> {
  let threadId: string | null = null;
  let failure: unknown = null;
  const cleanupFailures: unknown[] = [];

  if (closedGate) {
    const accountId = await readProtocolV3SmokeAccountId(config);
    executeProdD1(openProtocolV3SmokeWindowSql(accountId));
    if (
      readStoredProtocolV3SmokeSession() !== null ||
      readStoredProtocolV3SmokeRequestKey() !== null
    ) {
      await cleanInterruptedProtocolV3Smoke(config);
      executeProdD1(openProtocolV3SmokeWindowSql(accountId));
    }
  }

  try {
    const requestKey = `protocol-v3-cutover-${crypto.randomUUID()}`;
    if (closedGate) executeProdD1(storeProtocolV3SmokeRequestKeySql(requestKey));
    threadId = await createProtocolV3SmokeThread(config, requestKey);
    if (closedGate) executeProdD1(storeProtocolV3SmokeSessionSql(threadId));
    await waitForProtocolV3SmokeReady(threadId);
  } catch (error) {
    failure = error;
  } finally {
    if (threadId !== null) {
      try {
        await deleteProtocolV3SmokeThread(config, threadId);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }

    if (closedGate && cleanupFailures.length === 0 && threadId !== null) {
      try {
        executeProdD1(CLOSE_PROTOCOL_V3_SMOKE_WINDOW_SQL);
        if (!parseProtocolV3CommandFreeze(executeProdD1Json(PROTOCOL_V3_COMMAND_FREEZE_SQL))) {
          cleanupFailures.push(
            new Error("Protocol v3 command freeze did not close after live smoke."),
          );
        }
      } catch (error) {
        cleanupFailures.push(error);
      }
    } else if (closedGate) {
      writeStdout(
        `✗ Retaining the smoke allowance for cleanup recovery${threadId === null ? "." : ` of Session ${threadId}.`}`,
      );
    }
  }

  if (failure !== null || cleanupFailures.length > 0) {
    throw new AggregateError(
      [...(failure === null ? [] : [failure]), ...cleanupFailures],
      "Protocol v3 live Driver smoke or cleanup failed.",
    );
  }
}

async function deployWorkerAndVerify(
  smokeConfig: ProtocolV3SmokeConfig,
  queueApiConfig: ProdQueueApiConfig,
  closedGate: boolean,
  releaseTreeOid: string,
  cutoverState: ProtocolV3CutoverState | null,
): Promise<ProtocolV3CutoverState | null> {
  let state = cutoverState;
  let workerVersionId = state?.workerVersionId ?? null;
  let containerApplicationVersion = state?.containerApplicationVersion ?? null;
  let containerImageDigest = state?.containerImageDigest ?? null;
  if (
    workerVersionId === null ||
    containerApplicationVersion === null ||
    containerImageDigest === null
  ) {
    const previousApplication = await readProdContainerApplication(queueApiConfig);
    writeStdout("▶ Deploying protocol v3 Worker and Driver image");
    assertReleaseTreeUnchanged(releaseTreeOid);
    runProdMutation(apiWorkerDeployArgs(protocolV3ReleaseTag(releaseTreeOid)));
    assertReleaseTreeUnchanged(releaseTreeOid);
    workerVersionId = readExactProdWorkerVersion(releaseTreeOid);
    containerImageDigest = readTaggedContainerImageDigest(previousApplication, workerVersionId);
    const application = await waitForContainerRollout(
      queueApiConfig,
      containerImageDigest,
      previousApplication.version,
      null,
    );
    containerApplicationVersion = application.version;
  } else {
    if (state === null) throw new Error("Stored protocol v3 rollout state is missing.");
    writeStdout("▶ Reusing the exact protocol v3 Worker and Container rollout");
    await assertPublishedProtocolV3Release(state, releaseTreeOid, queueApiConfig);
    await waitForContainerRollout(
      queueApiConfig,
      containerImageDigest,
      containerApplicationVersion,
      containerApplicationVersion,
    );
  }

  writeStdout("▶ Verifying production Worker, D1, and local protocol contract");
  assertProtocolV3Artifacts();
  await verifyProdHealth();

  writeStdout("▶ Running a live protocol v3 Driver boot, hello, and ready smoke");
  await runProtocolV3LiveSmoke(smokeConfig, closedGate);

  if (readExactProdWorkerVersion(releaseTreeOid) !== workerVersionId) {
    throw new Error("Production Worker moved away from the published protocol v3 version.");
  }
  const application = await readProdContainerApplication(queueApiConfig);
  if (
    application.version !== containerApplicationVersion ||
    application.imageDigest !== containerImageDigest ||
    readTaggedContainerImageDigest(application, workerVersionId) !== containerImageDigest
  ) {
    throw new Error("Production Container rollout changed before release binding.");
  }

  if (state !== null && state.workerVersionId === null) {
    executeProdD1(
      storeProtocolV3RolloutSql(
        releaseTreeOid,
        workerVersionId,
        containerApplicationVersion,
        containerImageDigest,
      ),
    );
    state = readProtocolV3CutoverState();
  }
  if (state !== null) {
    await assertPublishedProtocolV3Release(state, releaseTreeOid, queueApiConfig);
  }
  return state;
}

async function runProtocolV3Cutover(
  initialPendingMigrations: readonly string[],
  localMigrationNames: readonly string[],
  smokeConfig: ProtocolV3SmokeConfig,
  queueApiConfig: ProdQueueApiConfig,
  expectedProdSchema: ProdSchemaCatalog,
  releaseTreeOid: string,
): Promise<void> {
  let bookmark: string | null = null;
  let migrationStarted = true;
  let queuesVerified = false;
  const durableMcpMigrationPending = initialPendingMigrations.includes(PROTOCOL_V3_MIGRATION);
  const sessionEventMigrationPending = initialPendingMigrations.includes(
    PROTOCOL_V3_SESSION_EVENT_MIGRATION,
  );
  const postRuntimeAuthorityMigration = !initialPendingMigrations.includes(
    PROTOCOL_V3_RUNTIME_AUTHORITY_MIGRATION,
  );

  try {
    writeStdout("▶ Installing the one-shot D1 admission gate");
    let cutoverState = installProtocolV3CutoverGate(releaseTreeOid, postRuntimeAuthorityMigration);
    migrationStarted = cutoverState.migrationStarted;
    if (cutoverState.phase === "queues_resuming") {
      if (initialPendingMigrations.length > 0) {
        throw new Error(
          "Protocol v3 queue-resume phase exists before every migration was applied.",
        );
      }
      await assertPublishedProtocolV3Release(cutoverState, releaseTreeOid, queueApiConfig);
      queuesVerified = !cutoverState.enabled;
      writeStdout(
        `▶ Recovering the durable production queue-resume ${cutoverState.enabled ? "pre-acceptance" : "accepted"} phase`,
      );
      await completeProtocolV3QueueResume(cutoverState, {
        commitAcceptance: acceptProtocolV3QueueResume,
        removeMarker: removeProtocolV3CutoverGate,
        resumeAndVerifyQueues: async () => {
          await resumeAndVerifyProdQueues(queueApiConfig);
          queuesVerified = true;
        },
      });
      return;
    }

    writeStdout("▶ Pausing production queue delivery for protocol v3 cutover");
    await pauseAndVerifyProdQueues(queueApiConfig);

    if (initialPendingMigrations.length > 0) {
      enterProtocolV3Drain();

      writeStdout("▶ Letting every already-admitted API command lane reach a terminal state");
      await resumeAndVerifyProdQueues(queueApiConfig);

      writeStdout("▶ Draining protocol v2 runtime state while control commands remain available");
      await waitForProtocolV3Drain(postRuntimeAuthorityMigration, false);

      writeStdout("▶ Freezing all new Driver commands at the final zero-state boundary");
      enableProtocolV3CommandFreeze();
      await waitForProtocolV3Drain(postRuntimeAuthorityMigration);

      writeStdout("▶ Re-pausing every API command lane after all admitted work is terminal");
      await pauseAndVerifyProdQueues(queueApiConfig);
      await waitForProtocolV3Drain(postRuntimeAuthorityMigration);
    } else {
      writeStdout("▶ Recovering any interrupted protocol v3 smoke before roll-forward");
      await cleanInterruptedProtocolV3Smoke(smokeConfig);
      executeProdD1(CLOSE_PROTOCOL_V3_SMOKE_WINDOW_SQL);
      enableProtocolV3CommandFreeze();
      writeStdout("▶ Re-proving the complete closed runtime boundary before roll-forward");
      await waitForProtocolV3Drain(postRuntimeAuthorityMigration);
    }

    if (durableMcpMigrationPending) {
      writeStdout("▶ Preflighting migration 0014 for lossy historical rewrites");
      verifyProdLossyMigrationInventory();
    }
    let legacyRewriteProof: LegacyRewriteProof | null = null;
    if (sessionEventMigrationPending) {
      writeStdout("▶ Preflighting legacy terminal integrity before migration 0015");
      legacyRewriteProof = preflightProdLegacyTerminalIntegrity();
    }
    if (initialPendingMigrations.includes(PROTOCOL_V3_RUNTIME_AUTHORITY_MIGRATION)) {
      writeStdout("▶ Preflighting runtime authority identities and terminal backups");
      assertProtocolV3RuntimeAuthorityPreflight(
        parseProtocolV3RuntimeAuthorityPreflight(
          executeProdD1Json(
            protocolV3RuntimeAuthorityPreflightSql(
              initialPendingMigrations.includes(PROTOCOL_V3_SESSION_CLEANUP_MIGRATION),
            ),
          ),
        ),
      );
    }

    bookmark =
      initialPendingMigrations.length > 0
        ? (readStoredProtocolV3Bookmark() ?? ensureProtocolV3Bookmark())
        : readStoredProtocolV3Bookmark();
    if (bookmark === null) {
      writeStdout(
        "  No emergency backup bookmark is available; this does not block roll-forward of the exact v3 release.",
      );
    } else {
      printProtocolV3EmergencyBookmark(bookmark);
    }

    writeStdout("▶ Re-pausing and independently verifying every production queue before migration");
    await pauseAndVerifyProdQueues(queueApiConfig);
    writeStdout("▶ Re-verifying the exact admission gate before migration");
    assertProtocolV3CutoverGateExact();
    assertReleaseTreeUnchanged(releaseTreeOid);

    if (initialPendingMigrations.length > 0) {
      writeStdout("▶ Persisting the irreversible D1 migration intent");
      migrationStarted = true;
      cutoverState = beginProtocolV3Migration(releaseTreeOid);
    }
    if (sessionEventMigrationPending) {
      if (bookmark === null) {
        throw new Error("Migration 0015 requires a persisted pre-migration D1 bookmark.");
      }
      writeStdout("▶ Authorizing the exact drained legacy terminal rewrite set");
      if (legacyRewriteProof === null) {
        throw new Error("Migration 0015 legacy rewrite preflight evidence is missing.");
      }
      authorizeProdLegacyTerminalRewrite(legacyRewriteProof, releaseTreeOid, bookmark);
    }
    writeStdout("▶ Applying pending D1 migrations behind the closed gate");
    applyD1Migrations();
    assertReleaseTreeUnchanged(releaseTreeOid);
    const remainingMigrations = readPendingProdMigrations(localMigrationNames);
    if (remainingMigrations.length > 0) {
      throw new Error(
        `Production D1 migrations remain pending behind the closed gate: ${remainingMigrations.join(", ")}.`,
      );
    }

    assertProtocolV3CutoverGateExact();

    writeStdout("▶ Verifying prod D1 schema matches the latest migration snapshot");
    assertProdSchemaMatchesSnapshot(expectedProdSchema);

    cutoverState =
      (await deployWorkerAndVerify(
        smokeConfig,
        queueApiConfig,
        true,
        releaseTreeOid,
        readProtocolV3CutoverState(),
      )) ?? cutoverState;

    writeStdout("▶ Rechecking the closed runtime boundary");
    await waitForProtocolV3Drain(true);

    writeStdout("▶ Persisting the durable production queue-resume phase");
    const queueResumeState = enterProtocolV3QueuesResuming();

    await completeProtocolV3QueueResume(queueResumeState, {
      commitAcceptance: acceptProtocolV3QueueResume,
      removeMarker: removeProtocolV3CutoverGate,
      resumeAndVerifyQueues: async () => {
        writeStdout("▶ Resuming and verifying production queues");
        await resumeAndVerifyProdQueues(queueApiConfig);
        queuesVerified = true;
      },
    });
  } catch (originalError) {
    return recoverProtocolV3CutoverFailure(
      { bookmark, initialPendingMigrations, migrationStarted, originalError, queuesVerified },
      {
        commitQueueAcceptance: acceptProtocolV3QueueResume,
        pauseAndVerifyQueues: () => pauseAndVerifyProdQueues(queueApiConfig),
        printBookmark: printProtocolV3EmergencyBookmark,
        probe: probeProtocolV3Cutover,
        readBookmark: readStoredProtocolV3Bookmark,
        readPendingMigrations: () => readPendingProdMigrations(localMigrationNames),
        removeMarker: removeProtocolV3CutoverGate,
        resumeAndVerifyQueues: () => resumeAndVerifyProdQueues(queueApiConfig),
        write: writeStdout,
      },
    );
  }
}

async function deployProduction(): Promise<void> {
  const expectedProdSchema = loadExpectedProdSchema();
  const localMigrationNames = readLocalMigrationNames();
  assertCutoverMigrationJournalAudited(localMigrationNames);
  const releaseTreeOid = readCleanReleaseTreeOid();

  runLocalPreflight(releaseTreeOid);
  const smokeConfig = readProtocolV3SmokeConfig();
  const queueApiConfig = readProdQueueApiConfig();
  const initialCutover = probeProtocolV3Cutover();
  if (initialCutover.gatePresent) {
    assertProtocolV3CutoverGateExact();
    assertProtocolV3Release(readProtocolV3CutoverState(), releaseTreeOid);
  }

  writeStdout("▶ Verifying the dedicated production smoke Agent is published cattle");
  assertProtocolV3SmokeAgent(executeProdD1Json(protocolV3SmokeAgentSql(smokeConfig.agentId)));

  writeStdout("▶ Acquiring the durable production deploy lease");
  const deployOwner = crypto.randomUUID();
  writeStdout(`  production deploy owner: ${deployOwner}`);
  try {
    acquireProdDeployLease(deployOwner, executeProdDeployLease);
  } catch (error) {
    writeStdout(
      `✗ Production deploy lease ownership was not proven for ${deployOwner}; a timed-out acquisition may still commit, so verify it is quiescent before any exact-owner manual release.`,
    );
    throw error;
  }

  try {
    const cutover = probeProtocolV3Cutover();
    const pendingMigrations = readPendingProdMigrations(localMigrationNames);
    if (cutover.gatePresent) {
      assertProtocolV3CutoverGateExact();
    }

    writeStdout("▶ Ensuring required production queues exist");
    ensureRequiredProdQueues();

    if (cutover.gatePresent || pendingMigrations.length > 0) {
      await runProtocolV3Cutover(
        pendingMigrations,
        localMigrationNames,
        smokeConfig,
        queueApiConfig,
        expectedProdSchema,
        releaseTreeOid,
      );
    } else {
      writeStdout("▶ Verifying prod D1 schema matches the latest migration snapshot");
      assertProdSchemaMatchesSnapshot(expectedProdSchema);

      await deployWorkerAndVerify(smokeConfig, queueApiConfig, false, releaseTreeOid, null);
    }
  } catch (error) {
    writeStdout(
      `✗ Retaining production deploy lease ${deployOwner}; verify that every remote mutation is quiescent before an exact-owner manual release.`,
    );
    throw error;
  }

  releaseProdDeployLease();
  writeStdout("✓ deploy complete");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    return deployProduction();
  }
  if (args.length === 1 && args[0] === "--protocol-v3-legacy-inventory") {
    writeStdout("▶ Auditing legacy production terminal source identities (read-only)");
    verifyProdLegacyTerminalSourceInventory();
    writeStdout("✓ legacy production terminal sources can be normalized deterministically");
    return;
  }
  if (args.length === 1 && args[0] === "--protocol-v3-lossy-migration-inventory") {
    writeStdout("▶ Auditing migration 0014 production history (read-only)");
    verifyProdLossyMigrationInventory();
    writeStdout("✓ migration 0014 has no lossy production candidates");
    return;
  }
  throw new Error(
    "Usage: bun apps/api/bin/deploy-prod.ts [--protocol-v3-legacy-inventory|--protocol-v3-lossy-migration-inventory]",
  );
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    writeStdout(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
