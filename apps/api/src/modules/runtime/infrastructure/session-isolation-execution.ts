import { createPlatformId, parsePlatformId } from "@mosoo/id";
import type { RuntimeOperationId, SandboxId } from "@mosoo/id";
import { type } from "arktype";

import type { SandboxMigrationFenceClaim } from "../../../adapters/durable-objects/sandbox-migration-fence";
import type { Sandbox } from "../../../adapters/durable-objects/sandbox.do";
import { withDisposedRpcResource } from "../../../platform/cloudflare/rpc-disposal";
import { requireSandboxBinding } from "../../../platform/cloudflare/sandbox-binding";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { sessionIsolationClaimOwner } from "../../sessions/infrastructure/session-isolation-barrier.repository";
import { decodeSandboxBackupIdForPlatform } from "./sandbox-backup-id";
import { getSandboxBackupObjectKeys } from "./sandbox-backup-platform";
import {
  prepareSessionIsolationClaim,
  prepareSessionIsolationRelease,
} from "./session-isolation-claim.repository";
import {
  buildSessionIsolationPlan,
  prepareSessionIsolationRollback,
} from "./session-isolation-plan";
import type { TransitionStatement } from "./session-isolation-plan";

const cohortSchema = type({
  sandbox: {
    id: "string",
    subjectId: "string",
    sandboxBinding: "string",
    statusSeq: "number.integer >= 0",
    updatedAt: "number.integer >= 0",
  },
  sessions: type({
    id: "string",
    statusSeq: "number.integer >= 0",
    archivedAt: "number.integer | null",
  }).array(),
});
const requestSchema = type({
  operationId: "string",
  cohort: cohortSchema,
  plan: "object",
  metadataHashes: { source: "string", prepared: "string", rollback: "string" },
});
const resourceSchema = type({
  sandboxId: "string",
  binding: "string",
  revision: "number.integer >= 0",
});
const executionSchema = type({
  version: "1",
  request: requestSchema,
  resources: resourceSchema.array(),
  claimAt: "number.integer >= 0",
  converted: "boolean",
  direction: "'forward' | 'rollback'",
  phase: "'prepared' | 'held' | 'converted' | 'restored' | 'releasing' | 'complete'",
});
type Execution = typeof executionSchema.infer;
type Resource = typeof resourceSchema.infer;
type Observation = Awaited<ReturnType<Sandbox["getMigrationFence"]>>;
interface MetadataExpectation {
  id: string;
  dir: string;
  minimumExpiresAt: number;
}
const metadataSchema = type({
  id: "string",
  dir: "string",
  createdAt: "string",
  ttl: "number.integer > 0",
  sizeBytes: "number.integer > 0",
});

// WebWorker's global Crypto declaration omits this documented workerd extension.
function supportsDigestStream(
  value: Crypto,
): value is Crypto & { DigestStream: typeof DigestStream } {
  return "DigestStream" in value && typeof value.DigestStream === "function";
}

export interface SessionIsolationExecutionPlatform {
  inspect(resource: Resource): Promise<Observation>;
  begin(resource: Resource, claim: SandboxMigrationFenceClaim): Promise<unknown>;
  stop(resource: Resource, claim: SandboxMigrationFenceClaim): Promise<unknown>;
  release(resource: Resource, claim: SandboxMigrationFenceClaim): Promise<unknown>;
  verifyObject(key: string, sha256: string, metadata?: MetadataExpectation): Promise<void>;
}

/** RPC only through the recorded namespace/normalized ID; never initialize the SDK to inspect. */
export function createSessionIsolationExecutionPlatform(
  bindings: ApiBindings,
): SessionIsolationExecutionPlatform {
  const call = <T>(resource: Resource, action: (stub: DurableObjectStub<Sandbox>) => Promise<T>) =>
    withDisposedRpcResource(
      requireSandboxBinding(bindings, resource.binding).getByName(resource.sandboxId.toLowerCase()),
      action,
    );
  return {
    inspect: (resource) => call(resource, (stub) => stub.getMigrationFence()),
    begin: (resource, claim) => call(resource, (stub) => stub.beginMigrationFence(claim)),
    stop: (resource, claim) => call(resource, (stub) => stub.stopMigrationFence(claim)),
    release: (resource, claim) => call(resource, (stub) => stub.completeMigrationFence(claim)),
    async verifyObject(key, expected, metadata) {
      const object = await bindings.SANDBOX_STATE_BUCKET.get(key);
      if (!object) throw new Error("A reviewed isolation recovery object is missing.");
      if (!supportsDigestStream(crypto))
        throw new Error("Streaming recovery verification is unavailable.");
      const digest = new crypto.DigestStream("SHA-256");
      let metadataText: string | undefined;
      if (metadata) {
        if (object.size > 65_536) throw new Error("Recovery metadata exceeds its size limit.");
        const [hashBody, jsonBody] = object.body.tee();
        [, metadataText] = await Promise.all([
          hashBody.pipeTo(digest),
          new Response(jsonBody).text(),
        ]);
      } else {
        await object.body.pipeTo(digest);
      }
      const actual = Array.from(new Uint8Array(await digest.digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      if (actual !== expected) throw new Error("A reviewed isolation recovery object changed.");
      if (metadata && metadataText !== undefined) {
        const parsed = metadataSchema.assert(JSON.parse(metadataText));
        const expiresAt = Date.parse(parsed.createdAt) + parsed.ttl * 1000;
        if (
          parsed.id !== metadata.id ||
          parsed.dir !== metadata.dir ||
          !Number.isSafeInteger(expiresAt) ||
          expiresAt < Math.max(metadata.minimumExpiresAt, Date.now() + 60_000)
        ) {
          throw new Error(
            "Recovery metadata does not preserve the reviewed workspace and lifetime.",
          );
        }
        const archive = await bindings.SANDBOX_STATE_BUCKET.head(
          getSandboxBackupObjectKeys(metadata.id)[0]!,
        );
        if (archive?.size !== parsed.sizeBytes)
          throw new Error("Recovery metadata does not match its archive size.");
      }
    },
  };
}

function isolationDedupeKey(operationId: string): string {
  return `session_isolation:${parsePlatformId<RuntimeOperationId>(operationId, "isolation operation")}`;
}

function owner(operationId: string): string {
  return sessionIsolationClaimOwner(
    parsePlatformId<RuntimeOperationId>(operationId, "isolation operation"),
  );
}

function cohort(execution: Execution) {
  return {
    ...execution.request.cohort,
    sandbox: {
      ...execution.request.cohort.sandbox,
      id: parsePlatformId<SandboxId>(execution.request.cohort.sandbox.id, "source Sandbox"),
    },
  };
}

function plan(execution: Execution) {
  const original = buildSessionIsolationPlan(execution.request.plan);
  return buildSessionIsolationPlan({
    ...execution.request.plan,
    operationId: execution.request.operationId,
    source: {
      ...original.before,
      session: {
        ...original.before.session,
        status_operation_id: execution.request.operationId,
        status_seq: Number(original.before.session["status_seq"]) + 1,
      },
      sandbox: {
        ...original.before.sandbox,
        claim_owner: owner(execution.request.operationId),
        updated_at: execution.claimAt,
      },
    },
  });
}

function statements(database: D1Database, batch: TransitionStatement[]) {
  return batch.map((s) => database.prepare(s.sql).bind(...s.params));
}

async function read(database: D1Database, operationId: string) {
  const row = await database
    .prepare(
      "SELECT payload_json FROM api_command WHERE dedupe_key = ? AND kind = 'session_isolation'",
    )
    .bind(isolationDedupeKey(operationId))
    .first<{ payload_json: string }>();
  if (!row) throw new Error("Session isolation operation was not prepared.");
  const execution = executionSchema.assert(JSON.parse(row.payload_json));
  if (execution.request.operationId !== operationId)
    throw new Error("Isolation operation ID mismatch.");
  return { execution, encoded: row.payload_json };
}

export async function inspectSessionIsolationExecution(database: D1Database, operationId: string) {
  const { execution } = await read(database, operationId);
  return { operationId, phase: execution.phase, direction: execution.direction };
}

async function transition(
  database: D1Database,
  previous: { execution: Execution; encoded: string },
  next: Execution,
  mutations: D1PreparedStatement[] = [],
) {
  const operationKey = isolationDedupeKey(next.request.operationId);
  const completed = next.phase === "complete";
  await database.batch([
    database
      .prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM api_command WHERE dedupe_key = ?
      AND kind = 'session_isolation' AND status = 'running' AND claim_expires_at IS NULL
      AND payload_json = ?) THEN 1 ELSE json('isolation operation changed') END`)
      .bind(operationKey, previous.encoded),
    ...mutations,
    database
      .prepare(`UPDATE api_command SET payload_json = ?, status = ?, updated_at = ?,
      completed_at = ?, claim_owner = ? WHERE dedupe_key = ? AND kind = 'session_isolation'`)
      .bind(
        JSON.stringify(next),
        completed ? "succeeded" : "running",
        Date.now(),
        completed ? Date.now() : null,
        completed ? null : owner(next.request.operationId),
        operationKey,
      ),
  ]);
}

async function verifyObjects(execution: Execution, platform: SessionIsolationExecutionPlatform) {
  const prepared = plan(execution);
  const pairs = [
    [
      prepared.before.sourceBackup,
      prepared.workspaceEvidence["sourceArchiveSha256"],
      execution.request.metadataHashes.source,
    ],
    [
      prepared.after.sourceBackup,
      prepared.workspaceEvidence["preparedArchiveSha256"],
      execution.request.metadataHashes.prepared,
    ],
    // The rollback insert is generated by the planner, not supplied SQL.
    [
      prepared.rollbackBackup,
      prepared.workspaceEvidence["rollbackArchiveSha256"],
      execution.request.metadataHashes.rollback,
    ],
  ] as const;
  // Once converted, rollback depends on its verified original-layout copy.
  // An unusable forward object must not block recovery from that intact copy.
  const required = execution.direction === "rollback" ? [pairs[2]] : pairs;
  for (const [backup, archiveHash, metadataHash] of required) {
    const backupId = backup["id"];
    if (
      typeof backupId !== "string" ||
      typeof archiveHash !== "string" ||
      typeof metadataHash !== "string" ||
      !/^[a-f0-9]{64}$/u.test(metadataHash)
    ) {
      throw new Error("Reviewed isolation object hashes are required.");
    }
    const [archive, metadata] = getSandboxBackupObjectKeys(backupId);
    await platform.verifyObject(archive!, archiveHash);
    await platform.verifyObject(metadata!, metadataHash, {
      id: decodeSandboxBackupIdForPlatform(backupId),
      dir: String(backup["dir"]),
      // Legacy D1 rows were recorded after SDK archive creation. The source
      // must still be usable now; new copies must cover their promised lifetime.
      minimumExpiresAt:
        backupId === prepared.before.sourceBackup["id"]
          ? Date.now() + 60_000
          : Number(backup["created_at"]) + Number(backup["ttl_seconds"]) * 1000,
    });
  }
}

/** Register the reviewed immutable input before acquiring either database or physical ownership. */
export async function prepareSessionIsolationExecution(
  database: D1Database,
  platform: SessionIsolationExecutionPlatform,
  value: unknown,
) {
  const request = requestSchema.assert(value);
  isolationDedupeKey(request.operationId);
  const original = buildSessionIsolationPlan(request.plan);
  const source = request.cohort.sandbox;
  const member = request.cohort.sessions.find((s) => s.id === original.before.session["id"]);
  if (
    source.id !== original.before.sandbox["id"] ||
    source.subjectId !== original.before.sandbox["subject_id"] ||
    source.sandboxBinding !== original.before.sandbox["sandbox_binding"] ||
    source.statusSeq !== original.before.sandbox["status_seq"] ||
    source.updatedAt !== original.before.sandbox["updated_at"] ||
    !member ||
    member.statusSeq !== original.before.session["status_seq"] ||
    member.archivedAt !== null
  ) {
    throw new Error("Reviewed isolation cohort does not describe the original source.");
  }
  const existing = await database
    .prepare("SELECT payload_json FROM api_command WHERE dedupe_key = ?")
    .bind(isolationDedupeKey(request.operationId))
    .first<{ payload_json: string }>();
  if (existing) {
    const saved = executionSchema.assert(JSON.parse(existing.payload_json));
    if (JSON.stringify(saved.request) !== JSON.stringify(request))
      throw new Error("Isolation operation input is immutable.");
    return inspectSessionIsolationExecution(database, request.operationId);
  }
  const resources: Resource[] = [];
  for (const row of [original.before.sandbox, original.after.sandbox]) {
    const resource = {
      sandboxId: String(row["id"]),
      binding: String(row["sandbox_binding"]),
      revision: 0,
    };
    const observed = await platform.inspect(resource);
    if (
      observed.operationId !== null ||
      observed.state === "unavailable" ||
      (resources.length > 0 && (observed.revision !== 0 || observed.state !== "stopped"))
    ) {
      throw new Error("Isolation requires an available source and a fresh stopped destination.");
    }
    resource.revision = observed.revision;
    resources.push(resource);
  }
  const execution: Execution = {
    version: 1,
    request,
    resources,
    claimAt: Date.now(),
    converted: false,
    direction: "forward",
    phase: "prepared",
  };
  await verifyObjects(execution, platform);
  await database.batch([
    ...statements(database, [original.forward[0]!]),
    database
      .prepare(
        "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM sandbox WHERE id = ?) THEN 1 ELSE json('isolation destination exists') END",
      )
      .bind(original.after.sandbox["id"]),
    database
      .prepare(`INSERT INTO api_command
      (id, kind, status, dedupe_key, payload_json, claim_owner, created_at, updated_at)
      VALUES (?, 'session_isolation', 'running', ?, ?, ?, ?, ?)`)
      .bind(
        createPlatformId(),
        isolationDedupeKey(request.operationId),
        JSON.stringify(execution),
        owner(request.operationId),
        execution.claimAt,
        execution.claimAt,
      ),
  ]);
  return inspectSessionIsolationExecution(database, request.operationId);
}

async function holdResources(execution: Execution, platform: SessionIsolationExecutionPlatform) {
  for (const resource of execution.resources) {
    const claim = { operationId: execution.request.operationId, revision: resource.revision };
    try {
      await platform.begin(resource, claim);
    } catch {
      // Acquisition intentionally resets the actor. Only a fresh observation of
      // our exact retained claim proves that a disconnect was successful.
    }
    const held = await platform.inspect(resource);
    if (
      held.operationId !== claim.operationId ||
      held.revision !== claim.revision ||
      held.resetRequired
    ) {
      throw new Error("Physical isolation ownership was not confirmed; resume the same operation.");
    }
    await platform.stop(resource, claim);
    const stopped = await platform.inspect(resource);
    if (
      stopped.operationId !== claim.operationId ||
      stopped.revision !== claim.revision ||
      stopped.stopping ||
      !stopped.stoppedVerified ||
      stopped.state !== "stopped"
    ) {
      throw new Error("Physical isolation stop was not confirmed; ownership remains held.");
    }
  }
}

/** A durable step may be retried after any lost acknowledgement; it never expires customer protection. */
export async function advanceSessionIsolationExecution(
  database: D1Database,
  platform: SessionIsolationExecutionPlatform,
  operationId: string,
) {
  const previous = await read(database, operationId);
  const state = previous.execution;
  const next = { ...state };
  const claim = {
    cohort: cohort(state),
    operationId: parsePlatformId<RuntimeOperationId>(operationId, "isolation operation"),
    now: state.claimAt,
  };
  switch (state.phase) {
    case "complete":
      return inspectSessionIsolationExecution(database, operationId);
    case "prepared": {
      next.phase = state.direction === "rollback" ? "complete" : "held";
      await transition(
        database,
        previous,
        next,
        state.direction === "rollback"
          ? []
          : [
              ...prepareSessionIsolationClaim(database, claim),
              // Reserve the destination in the same transaction before any physical
              // access. A conflicting existing resource leaves the entire cohort open.
              ...statements(database, [plan(state).forward[1]!]),
            ],
      );
      break;
    }
    case "held": {
      await holdResources(state, platform);
      next.phase = state.direction === "rollback" ? "restored" : "converted";
      next.converted = state.direction === "forward";
      if (state.direction === "forward") await verifyObjects(state, platform);
      const forward = plan(state).forward;
      await transition(
        database,
        previous,
        next,
        state.direction === "rollback"
          ? []
          : statements(database, [forward[0]!, ...forward.slice(2)]),
      );
      break;
    }
    case "converted": {
      if (state.direction === "rollback") {
        await holdResources(state, platform);
        await verifyObjects(state, platform);
        const current = await database
          .prepare("SELECT * FROM session WHERE id = ?")
          .bind(plan(state).before.session["id"])
          .first();
        const currentAgent = await database
          .prepare("SELECT * FROM agent WHERE id = ?")
          .bind(plan(state).before.agent["id"])
          .first();
        next.phase = "restored";
        await transition(
          database,
          previous,
          next,
          statements(database, prepareSessionIsolationRollback(plan(state), current, currentAgent)),
        );
      } else {
        next.phase = "releasing";
        await transition(database, previous, next);
      }
      break;
    }
    case "restored": {
      next.phase = "releasing";
      await transition(database, previous, next);
      break;
    }
    case "releasing": {
      for (const resource of state.resources) {
        await platform.release(resource, { operationId, revision: resource.revision });
      }
      next.phase = "complete";
      // A retry can observe completion before a newly admitted Run changes the
      // Session. Never infer completion by rereading mutable Session state.
      const release = prepareSessionIsolationRelease(database, { ...claim, now: Date.now() });
      if (!state.converted)
        release.splice(
          1,
          0,
          database
            .prepare(`DELETE FROM sandbox WHERE id = ? AND claim_owner = ?
        AND NOT EXISTS (SELECT 1 FROM sandbox_session WHERE sandbox_id = sandbox.id)
        AND NOT EXISTS (SELECT 1 FROM sandbox_backup WHERE sandbox_id = sandbox.id)`)
            .bind(plan(state).after.sandbox["id"], owner(operationId)),
        );
      await transition(database, previous, next, release);
      break;
    }
  }
  return inspectSessionIsolationExecution(database, operationId);
}

export async function requestSessionIsolationRollback(database: D1Database, operationId: string) {
  const previous = await read(database, operationId);
  if (previous.execution.direction === "rollback")
    return inspectSessionIsolationExecution(database, operationId);
  if (["releasing", "complete"].includes(previous.execution.phase)) {
    throw new Error("Admission release has begun; a new reviewed transition is required.");
  }
  await transition(database, previous, { ...previous.execution, direction: "rollback" });
  return inspectSessionIsolationExecution(database, operationId);
}
