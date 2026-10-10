import { test } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DriverEventEnvelope } from "@mosoo/agent-driver/events";
import type { DriverEventReceipt } from "@mosoo/agent-driver/orpc";
import {
  getNativeCheckpointRelativePath,
  parseNativeCheckpoint,
} from "@mosoo/agent-driver/runtime";
import type { NativeCheckpoint } from "@mosoo/agent-driver/runtime";
import { createPlatformId } from "@mosoo/id";
import type { DriverInstanceId, SessionRunId } from "@mosoo/id";

import { DriverArtifactTestController } from "../../driver/tests/driver-artifact-test-controller";
import { driverBootPayload } from "../../driver/tests/driver-boot-payload-fixture";
import { DriverInstanceRpcEventIngestionController } from "../src/modules/runtime/infrastructure/driver-instance/rpc-event-ingestion-controller";
import { DriverInstanceRuntimeState } from "../src/modules/runtime/infrastructure/driver-instance/runtime-state";
import { recordDriverInstanceCompletion } from "../src/modules/runtime/infrastructure/driver-instance/terminal-driver-events";
import { restoreNativeCheckpointBundle } from "../src/modules/runtime/infrastructure/native-checkpoint-bundle";
import type { SandboxHandle } from "../src/modules/runtime/infrastructure/sandbox-handles";
import { isSessionTerminalCheckpointReadyForNextRun } from "../src/modules/runtime/infrastructure/session-runs/session-run-admission.repository";
import { getSessionRunCompletionProof } from "../src/modules/runtime/infrastructure/session-runs/session-run-completion-proof";
import { canonicalRuntimeEventJson } from "../src/modules/sessions/infrastructure/session-runtime-event-store.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import {
  createPublicHttpContractDatabase,
  createPublicHttpTestBindings,
  insertOwnerSession,
  PUBLIC_API_TEST_IDS as IDS,
} from "./helpers/public-api-http-test-fixture";
import type { SqliteD1Database } from "./helpers/public-api-http-test-fixture";

// This imports exported helpers only; it does not register the ingestion test suite.
// sessionId is the fixture owner's Session; choose it in the native Driver boot input.
async function createNativeIngestionFixture(driverId: string, runId: string) {
  const database = await createPublicHttpContractDatabase({ maxBoundParams: 100 });
  await insertOwnerSession(database);
  const sessionId = IDS.ownerSession;
  const canonicalHostCwd = `/workspace/se/${sessionId}`;
  const now = Date.now();
  await database.batch([
    database
      .prepare(`INSERT INTO sandbox (
      id, kind, subject_kind, subject_id, project_id, owner_account_id, status,
      bind_mount_ready, global_mounts_json, created_at, updated_at
    ) VALUES (?, 'cattle', 'session', ?, ?, ?, 'active', 1, '[]', ?, ?)`)
      .bind(IDS.sandbox, sessionId, IDS.project, IDS.ownerAccount, now, now),
    database
      .prepare(`INSERT INTO sandbox_session (
      cloudflare_session_id, created_at, cwd, origin_json, sandbox_id,
      session_id, status, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`)
      .bind(
        "01J0000000000000000000000Z",
        now,
        canonicalHostCwd,
        JSON.stringify({
          callerUserId: IDS.ownerAccount,
          entrypoint: "api",
          executionOwnerUserId: IDS.ownerAccount,
          type: "agent",
        }),
        IDS.sandbox,
        sessionId,
        now,
      ),
    database
      .prepare(`INSERT INTO driver_instance (
      id, boot_token_expires_at, boot_token_hash, connection_id, created_at,
      expires_at, heartbeat_count, protocol, protocol_version, runtime,
      sandbox_id, sandbox_session_id, status, updated_at
    ) VALUES (?, ?, X'01', 'canary-connection', ?, ?, 0,
      'orpc-ws', 1, 'claude-agent-sdk', ?, ?, 'ready', ?)`)
      .bind(driverId, now + 60_000, now, now + 60_000, IDS.sandbox, sessionId, now),
    database
      .prepare(`INSERT INTO session_run (
      id, session_id, agent_id, created_by_account_id, deployment_version_id,
      deployment_version_number, driver_instance_id, trigger, status, provider,
      model, runtime_id, trace_id, started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, 'user_prompt', 'running', 'anthropic',
      'claude-sonnet-4-5', 'claude-agent-sdk', 'trace-native-host-canary', ?, ?, ?)`)
      .bind(runId, sessionId, IDS.agent, IDS.ownerAccount, IDS.deployment, driverId, now, now, now),
    database
      .prepare(`UPDATE session SET kind = 'cattle', last_message_at = ?,
      last_run_id = ?, status = 'RUNNING' WHERE id = ?`)
      .bind(now, runId, sessionId),
  ]);
  // Let the real runtime.resume.updated establish native_resume_ref.
  return {
    database,
    bindings: createPublicHttpTestBindings(database),
    sessionId,
    canonicalHostCwd,
    sandboxId: IDS.sandbox,
  };
}

async function assertNativeCompletion(input: {
  database: SqliteD1Database;
  terminal: DriverEventEnvelope;
  receipt: DriverEventReceipt;
  canonicalHostCwd: string;
}) {
  const { database, terminal, receipt } = input;
  assert.equal(terminal.event.kind, "run.completed");
  const event = terminal.event;
  const sessionId = event.sessionId;
  const runId = event.runId!;
  const checkpoint = (
    event.payload as {
      checkpoint: {
        formatVersion: number;
        runId: string;
        nativeRef: { kind: string; runtimeId: string; value: string };
      };
    }
  ).checkpoint;
  assert.equal(checkpoint.runId, runId);
  const stored = await database
    .prepare(`SELECT source_event_id, seq, event_type,
    canonical_event_json FROM session_event WHERE session_id = ? AND source_event_id = ?`)
    .bind(sessionId, terminal.eventId)
    .first<{
      source_event_id: string;
      seq: number;
      event_type: string;
      canonical_event_json: string;
    }>();
  assert(stored);
  assert.deepEqual(receipt, {
    eventId: stored.source_event_id,
    seq: stored.seq,
    type: stored.event_type,
  });
  assert.equal(stored.canonical_event_json, canonicalRuntimeEventJson(event));
  const session = await database
    .prepare(`SELECT s.last_run_id,
    s.workspace_checkpoint_required, s.status, r.status AS run_status
    FROM session s JOIN session_run r ON r.id = s.last_run_id WHERE s.id = ?`)
    .bind(sessionId)
    .first();
  assert.deepEqual(session, {
    last_run_id: runId,
    workspace_checkpoint_required: 1,
    status: "IDLE",
    run_status: "completed",
  });
  // This join proves the backup belongs to the same Run and linked workspace.
  const backup = await database
    .prepare(`SELECT b.id, b.session_run_id, b.status, b.dir,
    b.sandbox_id FROM sandbox_backup b
    JOIN sandbox_session ss ON ss.sandbox_id = b.sandbox_id AND ss.cwd = b.dir
    JOIN session_event e ON e.session_id = ss.session_id AND e.run_id = b.session_run_id
    WHERE ss.session_id = ? AND b.session_run_id = ? AND b.status = 'ready'
      AND e.event_type = 'run.completed' AND e.source_event_id = ?`)
    .bind(sessionId, runId, terminal.eventId)
    .first<Record<string, unknown>>();
  assert(backup);
  assert.equal(backup.dir, input.canonicalHostCwd);
  assert.equal(backup.sandbox_id, IDS.sandbox);
  const cursor = await database
    .prepare(`SELECT kind, runtime_id, value,
    observed_session_run_id, committed_format_version, committed_session_run_id,
    committed_value, invalidated_at, invalidated_source_event_id
    FROM native_resume_ref WHERE session_id = ?`)
    .bind(sessionId)
    .first();
  assert.deepEqual(cursor, {
    kind: checkpoint.nativeRef.kind,
    runtime_id: checkpoint.nativeRef.runtimeId,
    value: checkpoint.nativeRef.value,
    observed_session_run_id: runId,
    committed_format_version: checkpoint.formatVersion,
    committed_session_run_id: runId,
    committed_value: checkpoint.nativeRef.value,
    invalidated_at: null,
    invalidated_source_event_id: null,
  });
  assert.equal(await isSessionTerminalCheckpointReadyForNextRun(database, sessionId), true);
  const proof = await getSessionRunCompletionProof(database, { sessionId, runId });
  assert(proof);
  assert.equal(proof.sourceEventId, terminal.eventId);
  assert.equal(canonicalRuntimeEventJson(proof.event), stored.canonical_event_json);
  return { backup, cursor, receipt: stored };
}

// Run with just test-native-host-checkpoint on Linux with squashfs-tools installed.
// The model HTTP endpoint is local; all Claude events come from the pinned native CLI.
test.skipIf(process.env.MOSOO_NATIVE_HOST_CHECKPOINT !== "1")(
  "native Claude completion crosses ORPC, commits Host D1 backup, and restores in a new Driver",
  async () => {
    const driverRequire = createRequire(new URL("../../driver/package.json", import.meta.url));
    const sdkRequire = createRequire(driverRequire.resolve("@anthropic-ai/claude-agent-sdk"));
    const claudeExecutable =
      process.env.MOSOO_CLAUDE_CODE_EXECUTABLE ??
      sdkRequire.resolve(
        `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`,
      );
    const root = await mkdtemp(join(tmpdir(), "mosoo-native-host-"));
    const workspace = join(root, "workspace");
    const home = join(root, "home");
    await mkdir(workspace);
    await mkdir(home);
    const marker = `native-host-${randomUUID()}`;
    const firstPrompt = `Remember ${marker}. Reply pong with the marker. Do not use tools.`;
    const restoredPrompt =
      "Reply pong with the marker remembered from the earlier user message. Do not use tools.";
    const driverId = createPlatformId<DriverInstanceId>();
    const runId = createPlatformId<SessionRunId>();
    const fixture = await createNativeIngestionFixture(driverId, runId);
    const { database, canonicalHostCwd, sessionId } = fixture;
    const terminals: DriverEventEnvelope[] = [];
    const receipts = new Map<string, DriverEventReceipt>();
    const archives = new Map<string, string>();
    const completions: string[] = [];
    const providerBodies: string[] = [];
    let verifyCalls = 0;
    let controller: DriverArtifactTestController | null = null;
    let stopped = false;
    const model = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith("/count_tokens"))
          return Response.json({ input_tokens: 5 });
        if (new URL(request.url).pathname !== "/v1/messages") return Response.json({});
        const body = (await request.json()) as {
          model: string;
          messages: { role: string; content: unknown }[];
          stream: boolean;
        };
        const history = JSON.stringify(body.messages);
        providerBodies.push(history);
        assert(providerBodies.length <= 2, "Unexpected extra model request");
        assert(history.includes(marker), "Native restore lost the first Run's marker");
        const content = `pong ${marker}`;
        if (providerBodies.length === 2) {
          const messageIndex = (role: string, text: string) =>
            body.messages.findIndex(
              (message) =>
                message.role === role && (JSON.stringify(message.content) ?? "").includes(text),
            );
          const previousUser = messageIndex("user", firstPrompt);
          const previousAssistant = messageIndex("assistant", content);
          const currentUser = messageIndex("user", restoredPrompt);
          assert(
            previousUser >= 0 &&
              previousAssistant > previousUser &&
              currentUser > previousAssistant,
            "Native restore must retain the prior user and assistant before the new user message",
          );
        }
        const usage = {
          input_tokens: 5,
          output_tokens: 3,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        };
        const message = {
          id: `msg_${providerBodies.length}`,
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: content }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage,
        };
        if (!body.stream) return Response.json(message);
        const events = [
          {
            type: "message_start",
            message: {
              ...message,
              content: [],
              stop_reason: null,
              usage: { ...usage, output_tokens: 0 },
            },
          },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: content } },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 3 },
          },
          { type: "message_stop" },
        ];
        return new Response(
          events
            .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            .join(""),
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    const runCommand = async (args: string[]) => {
      const child = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30_000,
        killSignal: "SIGKILL",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exitCode, stdout, stderr, success: exitCode === 0 };
    };
    const unavailable = async (): Promise<never> => {
      throw new Error("Unexpected sandbox operation");
    };
    const sandbox: SandboxHandle = {
      configureNetworkConstraints: unavailable,
      createSession: unavailable,
      deleteSession: unavailable,
      destroy: unavailable,
      ensureContainerReady: unavailable,
      getSession: async () => sandbox,
      mkdir: unavailable,
      mountBucket: unavailable,
      readFile: unavailable,
      setKeepAlive: unavailable,
      startProcess: unavailable,
      unmountBucket: async () => {},
      writeFile: unavailable,
      async exec(command) {
        if (command.includes("Native checkpoint manifest does not match")) verifyCalls++;
        return runCommand(["sh", "-c", command.replaceAll(canonicalHostCwd, workspace)]);
      },
      async createBackup({ dir }) {
        assert.equal(dir, canonicalHostCwd);
        const id = randomUUID();
        const archive = join(root, `${id}.sqsh`);
        const result = await runCommand([
          process.env.MOSOO_MKSQUASHFS ?? "mksquashfs",
          workspace,
          archive,
          "-comp",
          "zstd",
          "-processors",
          "1",
          "-no-progress",
          "-noappend",
        ]);
        assert.equal(result.exitCode, 0, result.stderr);
        archives.set(id, archive);
        return { dir, id };
      },
      async restoreBackup({ dir, id }) {
        const archive = archives.get(id);
        assert(archive, "Host selected an unknown backup");
        const result = await runCommand([
          process.env.MOSOO_UNSQUASHFS ?? "unsquashfs",
          "-no-progress",
          "-d",
          dir,
          archive,
        ]);
        assert.equal(result.exitCode, 0, result.stderr);
        return { dir, id };
      },
    };
    const bindings: ApiBindings = {
      ...fixture.bindings,
      SANDBOX_STATE_BUCKET: { delete: async () => {} } as unknown as R2Bucket,
      runtimeSubjectHandleFactory: () => sandbox,
    };
    const start = async (id: DriverInstanceId, checkpoint: NativeCheckpoint | null) => {
      stopped = false;
      const state = new DriverInstanceRuntimeState({ storage: {} as never });
      state.driverInstanceId = id;
      state.hello = {} as never;
      const ingestion = new DriverInstanceRpcEventIngestionController({
        env: bindings,
        state,
      } as never);
      const boot = structuredClone(driverBootPayload);
      const started = await DriverArtifactTestController.start({
        artifactPath:
          process.env.MOSOO_NATIVE_HOST_ARTIFACT ??
          new URL("../../driver/dist/driver.mjs", import.meta.url).pathname,
        rootPath: root,
        organizationPath: workspace,
        startTimeoutMs: 20_000,
        env: { MOSOO_CLAUDE_CODE_EXECUTABLE: claudeExecutable },
        bootPayload: {
          ...boot,
          driverInstanceId: id,
          runtime: "claude-agent-sdk",
          runtimeTransport: "claude-agent-sdk",
          execution: {
            ...boot.execution,
            provider: "anthropic",
            model: "claude-sonnet-4-5",
            configRevision: { ...boot.execution.configRevision, runId: null, sessionId },
            environment: {
              variables: {
                ANTHROPIC_API_KEY: "fixture-only",
                ANTHROPIC_BASE_URL: model.url.origin,
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
                DISABLE_ERROR_REPORTING: "1",
                DISABLE_TELEMETRY: "1",
              },
            },
            session: {
              ...boot.execution.session,
              cwd: workspace,
              context: {
                ...boot.execution.session.context,
                homePath: home,
                sessionOrganizationPath: workspace,
              },
              nativeCheckpoint: checkpoint,
              nativeResumeRef: checkpoint?.nativeRef ?? null,
            },
          },
        },
        async pushEvents(batch) {
          const result = await ingestion.handlePushEvents(batch, {
            assertActiveConnection: () => {},
            connectionId: checkpoint === null ? "canary-connection" : "restored-connection",
          } as never);
          for (const envelope of batch.events)
            if (envelope.event.kind === "run.completed") terminals.push(envelope);
          for (const receipt of result.accepted) receipts.set(receipt.eventId, receipt);
          return result;
        },
        async completeRun(input) {
          await recordDriverInstanceCompletion(bindings, {
            driverInstanceId: id,
            runId: input.runId as SessionRunId,
          });
          completions.push(input.runId);
        },
      });
      return started;
    };
    try {
      controller = await start(driverId, null);
      await controller.runTurn({
        commandId: createPlatformId(),
        requestId: createPlatformId(),
        runId,
        text: firstPrompt,
        timeoutMs: 30_000,
      });
      assert.equal(terminals.length, 1);
      const firstTerminal = terminals[0];
      const firstProof = await assertNativeCompletion({
        database,
        terminal: firstTerminal,
        receipt: receipts.get(firstTerminal.eventId)!,
        canonicalHostCwd,
      });
      const checkpoint = parseNativeCheckpoint(
        (firstTerminal.event.payload as { checkpoint: unknown }).checkpoint,
      );
      const bundle = join(workspace, getNativeCheckpointRelativePath(checkpoint.runId));
      const manifest = await readFile(join(bundle, "manifest.json"));
      const firstOwners = controller.providerOwnerIds();
      const firstPids = controller.providerProcessIds();
      assert(firstPids.length > 0);
      await controller.stopDriver(createPlatformId(), 10_000);
      assert.deepEqual(controller.providerProcessIdsForOwners(firstOwners), []);
      await controller.dispose();
      controller = null;
      stopped = true;
      assert.deepEqual(completions, [runId]);
      await rm(home, { recursive: true });
      await rm(bundle, { recursive: true });
      await mkdir(home);
      await restoreNativeCheckpointBundle(bindings, sandbox, {
        backupId: String(firstProof.backup.id),
        checkpoint,
        cwd: canonicalHostCwd,
      });
      assert.deepEqual(await readFile(join(bundle, "manifest.json")), manifest);
      const nextDriverId = createPlatformId<DriverInstanceId>();
      const nextRunId = createPlatformId<SessionRunId>();
      const now = Date.now();
      await database.batch([
        database
          .prepare("UPDATE driver_instance SET status = 'stopped', updated_at = ? WHERE id = ?")
          .bind(now, driverId),
        database
          .prepare(
            "INSERT INTO driver_instance (id, boot_token_expires_at, boot_token_hash, connection_id, created_at, expires_at, heartbeat_count, protocol, protocol_version, runtime, sandbox_id, sandbox_session_id, status, updated_at) VALUES (?, ?, X'02', 'restored-connection', ?, ?, 0, 'orpc-ws', 1, 'claude-agent-sdk', ?, ?, 'ready', ?)",
          )
          .bind(nextDriverId, now + 60_000, now, now + 60_000, IDS.sandbox, sessionId, now),
        database
          .prepare(
            "INSERT INTO session_run (id, session_id, agent_id, created_by_account_id, deployment_version_id, deployment_version_number, driver_instance_id, trigger, status, provider, model, runtime_id, trace_id, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, 'user_prompt', 'running', 'anthropic', 'claude-sonnet-4-5', 'claude-agent-sdk', 'trace-native-host-restore', ?, ?, ?)",
          )
          .bind(
            nextRunId,
            sessionId,
            IDS.agent,
            IDS.ownerAccount,
            IDS.deployment,
            nextDriverId,
            now,
            now,
            now,
          ),
        database
          .prepare("UPDATE session SET last_run_id = ?, status = 'RUNNING' WHERE id = ?")
          .bind(nextRunId, sessionId),
      ]);
      controller = await start(nextDriverId, checkpoint);
      const restoredEvents = await controller.runTurn({
        commandId: createPlatformId(),
        requestId: createPlatformId(),
        runId: nextRunId,
        text: restoredPrompt,
        timeoutMs: 30_000,
      });
      assert(
        restoredEvents.some(
          (event) =>
            event.kind === "message.delta" && JSON.stringify(event.payload).includes(marker),
        ),
      );
      assert.equal(terminals.length, 2);
      const secondTerminal = terminals[1];
      await assertNativeCompletion({
        database,
        terminal: secondTerminal,
        receipt: receipts.get(secondTerminal.eventId)!,
        canonicalHostCwd,
      });
      const restoredPids = controller.providerProcessIds();
      assert(restoredPids.length > 0);
      assert(restoredPids.every((pid) => !firstPids.includes(pid)));
      const restoredOwners = controller.providerOwnerIds();
      await controller.stopDriver(createPlatformId(), 10_000);
      assert.deepEqual(controller.providerProcessIdsForOwners(restoredOwners), []);
      await controller.dispose();
      controller = null;
      stopped = true;
      assert.deepEqual(completions, [runId, nextRunId]);
      assert.equal(providerBodies.length, 2);
      assert(verifyCalls >= 3);
      console.info(
        JSON.stringify({
          nativeHostCheckpoint: "PASS",
          modelRequests: providerBodies.length,
          hostVerifiedBundles: verifyCalls,
          canonicalReceipts: terminals.map((terminal) => receipts.get(terminal.eventId)),
          readyBackups: archives.size,
          newProcessRestoredHistory: true,
        }),
      );
    } finally {
      try {
        if (controller !== null) {
          await controller.dispose();
        }
      } finally {
        model.stop(true);
        if (stopped) await rm(root, { recursive: true, force: true });
      }
    }
  },
  90_000,
);
