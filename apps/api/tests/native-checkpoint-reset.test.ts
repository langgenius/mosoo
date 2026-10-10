import { describe, expect, test } from "bun:test";

import { parseNativeCheckpoint } from "@mosoo/agent-driver/runtime";
import { createRuntimeEvent } from "@mosoo/runtime-events";

import type { RuntimeSessionLink } from "../src/modules/runtime/infrastructure/driver-instance/event-types";
import { resetNativeResumeCheckpoint } from "../src/modules/runtime/infrastructure/native-checkpoint-reset";
import { getNativeContinuationForRuntime } from "../src/modules/runtime/infrastructure/native-resume-ref.repository";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const sessionId = "01J000000000000000000000G1";
const driverInstanceId = "01J000000000000000000000G2";
const runId = "01J000000000000000000000G3";
const nextRunId = "01J000000000000000000000G4";
const previousCheckpoint = parseNativeCheckpoint({
  formatVersion: 1,
  runId,
  nativeRef: { kind: "claude_session_id", runtimeId: "claude-agent-sdk", value: "native-old" },
});
const newNativeRef = { ...previousCheckpoint.nativeRef, value: "native-new" };
const link: RuntimeSessionLink = {
  agentId: null,
  callerId: null,
  creatorId: null,
  executionOwnerId: null,
  projectId: null,
  sandboxId: "01J000000000000000000000G5",
  sandboxSubjectKind: "session",
  sessionId,
  sessionRunId: null,
  sessionRunStatus: null,
  sessionType: null,
  traceId: null,
};

function database() {
  const db = new SqliteD1Database({ foreignKeys: false, maxBoundParams: 100 });
  db.execute(`
    CREATE TABLE session (id text PRIMARY KEY, agent_id text, archived_at integer, status text,
      runtime_event_seq_cursor integer DEFAULT 0 NOT NULL);
    INSERT INTO session(id,status) VALUES ('${sessionId}', 'IDLE');
    CREATE TABLE sandbox_session (session_id text PRIMARY KEY, sandbox_id text, status text);
    INSERT INTO sandbox_session VALUES ('${sessionId}', '${link.sandboxId}', 'active');
    CREATE TABLE native_resume_ref (
      committed_format_version integer, committed_session_run_id text, committed_value text,
      created_at integer NOT NULL, invalidated_at integer, invalidated_source_event_id text,
      kind text NOT NULL, observed_driver_instance_id text, observed_session_run_id text,
      runtime_id text NOT NULL, session_id text PRIMARY KEY, updated_at integer NOT NULL, value text NOT NULL
    );
    INSERT INTO native_resume_ref(committed_format_version,committed_session_run_id,committed_value,
      created_at,kind,runtime_id,session_id,updated_at,value)
      VALUES(1,'${runId}','native-old',1,'claude_session_id','claude-agent-sdk','${sessionId}',1,'native-old');
    CREATE TABLE session_event (
      agent_id text, canonical_event_json text, content_text text NOT NULL, created_at integer NOT NULL,
      ended_at integer NOT NULL, event_type text NOT NULL, family text NOT NULL, id text PRIMARY KEY,
      occurred_at integer NOT NULL, process_status text NOT NULL, process_type text NOT NULL, run_id text,
      seq integer NOT NULL, session_id text NOT NULL, source_event_id text NOT NULL, source text NOT NULL,
      tool_call_id text, tool_input_json text, tool_name text, tokens integer, trace_id text, visibility text NOT NULL,
      UNIQUE(session_id,source_event_id), UNIQUE(session_id,seq)
    );
  `);
  return db;
}

function input(sourceEventId = "reset-1") {
  const payload = {
    previousCheckpoint,
    previousNativeRef: previousCheckpoint.nativeRef,
    newNativeRef,
  };
  return {
    ...payload,
    driverInstanceId,
    link,
    record: {
      sourceEventId,
      occurredAt: 1_000,
      event: createRuntimeEvent({
        actor: "driver",
        driverInstanceId,
        id: sourceEventId,
        kind: "runtime.session.reset",
        occurredAt: new Date(1_000).toISOString(),
        origin: "driver",
        payload,
        runtimeId: "claude-agent-sdk",
        sessionId,
        sourceEventId,
      }),
    },
  };
}

function bindings(db: SqliteD1Database) {
  return { DB: db } as ApiBindings;
}

describe("native checkpoint reset", () => {
  test("persists an idle reset and its receipt together without a Run link", async () => {
    const db = database();
    await resetNativeResumeCheckpoint(bindings(db), input());
    await expect(
      getNativeContinuationForRuntime(db, { runtimeId: "claude-agent-sdk", sessionId }),
    ).resolves.toEqual({
      status: "invalidated",
      sourceEventId: "reset-1",
    });
    expect(await db.prepare("SELECT event_type,seq FROM session_event").first()).toEqual({
      event_type: "runtime.session.reset",
      seq: 1,
    });
  });

  test("an idle reset before the first completed Run creates an explicit tombstone", async () => {
    const db = database();
    db.execute("DELETE FROM native_resume_ref");
    const reset = input();
    const initial = {
      ...reset,
      previousCheckpoint: null,
      record: {
        ...reset.record,
        event: {
          ...reset.record.event,
          payload: {
            previousCheckpoint: null,
            previousNativeRef: previousCheckpoint.nativeRef,
            newNativeRef,
          },
        },
      },
    };
    await resetNativeResumeCheckpoint(bindings(db), initial);
    await expect(
      getNativeContinuationForRuntime(db, { runtimeId: "claude-agent-sdk", sessionId }),
    ).resolves.toEqual({
      status: "invalidated",
      sourceEventId: "reset-1",
    });
  });

  test("a replay returns the original receipt after a newer checkpoint commits", async () => {
    const db = database();
    await resetNativeResumeCheckpoint(bindings(db), input());
    db.execute(`UPDATE native_resume_ref SET committed_session_run_id='${nextRunId}', committed_value='native-new',
      invalidated_at=NULL,invalidated_source_event_id=NULL`);
    await resetNativeResumeCheckpoint(bindings(db), input());
    expect(
      await db
        .prepare("SELECT committed_session_run_id,invalidated_at FROM native_resume_ref")
        .first(),
    ).toEqual({
      committed_session_run_id: nextRunId,
      invalidated_at: null,
    });
    expect(await db.prepare("SELECT count(*) AS count FROM session_event").first()).toEqual({
      count: 1,
    });
  });

  test("a changed event identity and a stale reset cannot invalidate a newer checkpoint", async () => {
    const db = database();
    await resetNativeResumeCheckpoint(bindings(db), input());
    const changed = input();
    changed.record.event = { ...changed.record.event, occurredAt: new Date(2_000).toISOString() };
    await expect(resetNativeResumeCheckpoint(bindings(db), changed)).rejects.toThrow(
      "different runtime event",
    );
    db.execute(`UPDATE native_resume_ref SET committed_session_run_id='${nextRunId}', committed_value='native-new',
      invalidated_at=NULL,invalidated_source_event_id=NULL`);
    await expect(resetNativeResumeCheckpoint(bindings(db), input("stale-reset"))).rejects.toThrow(
      "conflicts",
    );
    expect(await db.prepare("SELECT invalidated_at FROM native_resume_ref").first()).toEqual({
      invalidated_at: null,
    });
  });

  test("maintenance and idle close claims prevent a racing reset", async () => {
    const db = database();
    db.execute("UPDATE session SET status='RESCHEDULING'");
    await expect(resetNativeResumeCheckpoint(bindings(db), input())).rejects.toThrow(
      "lifecycle operation",
    );
    db.execute("UPDATE session SET status='IDLE'; UPDATE sandbox_session SET status='closed'");
    await expect(resetNativeResumeCheckpoint(bindings(db), input())).rejects.toThrow(
      "lifecycle operation",
    );
    expect(await db.prepare("SELECT invalidated_at FROM native_resume_ref").first()).toEqual({
      invalidated_at: null,
    });
  });

  test("receipt storage failure rolls back native invalidation", async () => {
    const db = database();
    db.execute(
      "CREATE TRIGGER reject_receipt BEFORE INSERT ON session_event BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END;",
    );
    await expect(resetNativeResumeCheckpoint(bindings(db), input())).rejects.toThrow();
    expect(await db.prepare("SELECT value,invalidated_at FROM native_resume_ref").first()).toEqual({
      value: "native-old",
      invalidated_at: null,
    });
  });
});
