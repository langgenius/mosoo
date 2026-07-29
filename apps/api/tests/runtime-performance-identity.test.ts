import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { SandboxSessionId } from "@mosoo/id";
import { PLATFORM_ID_FIXTURES } from "@mosoo/id/testing";
import { serializeRuntimeTimingProcessContent } from "@mosoo/runtime-events";

import {
  parseDriverRuntimeIdentitySnapshot,
  parseRuntimePerformanceIdentityEvidence,
  parseRuntimePerformanceTimingRows,
} from "../src/modules/runtime/infrastructure/performance/runtime-performance-identity.service";
import {
  RUNTIME_PERFORMANCE_IDENTITY_EVIDENCE_SCHEMA,
  createSessionRuntimePerformanceIdentityEvidence,
  runtimePerformanceIdentityEvidenceEnabled,
} from "../src/modules/sessions/infrastructure/session/runtime-performance-identity-evidence";

const SANDBOX_SESSION_ID = parsePlatformId<SandboxSessionId>("01J0000000000000000000000T");

const runtimeIdentity = {
  containerApplicationId: "application-id",
  containerDeploymentId: "deployment-id",
  containerDurableObjectId: "ABCDEF0123",
  containerPlacementId: "placement-id",
  driverBundleSha256: "a".repeat(64),
  observedAt: "2026-07-19T00:00:01.000Z",
};

describe("runtime performance identity", () => {
  test("enables evidence only for a non-empty staging token", () => {
    expect(runtimePerformanceIdentityEvidenceEnabled(undefined)).toBeFalse();
    expect(runtimePerformanceIdentityEvidenceEnabled("")).toBeFalse();
    expect(runtimePerformanceIdentityEvidenceEnabled("  ")).toBeFalse();
    expect(runtimePerformanceIdentityEvidenceEnabled("staging-token")).toBeTrue();
  });

  test("parses the Driver hello Cloudflare Container attestation", () => {
    expect(
      parseDriverRuntimeIdentitySnapshot({
        containerApplicationId: "application-id",
        containerDeploymentId: "deployment-id",
        containerDurableObjectId: "ABCDEF0123",
        containerPlacementId: "placement-id",
        driverBundleSha256: "a".repeat(64),
        observedAt: "2026-07-19T00:00:00.000Z",
      }),
    ).toEqual({
      containerApplicationId: "application-id",
      containerDeploymentId: "deployment-id",
      containerDurableObjectId: "abcdef0123",
      containerObservedAt: "2026-07-19T00:00:00.000Z",
      containerPlacementId: "placement-id",
      driverBundleSha256: "a".repeat(64),
    });
  });

  test("rejects incomplete or invalid Driver hello attestation", () => {
    expect(() => parseDriverRuntimeIdentitySnapshot(null)).toThrow("hello attestation");
    expect(() =>
      parseDriverRuntimeIdentitySnapshot({
        containerApplicationId: "application",
        containerDeploymentId: "deployment",
        containerDurableObjectId: "do",
        containerPlacementId: "placement",
        driverBundleSha256: "not-a-sha",
        observedAt: "2026-07-19T00:00:00.000Z",
      }),
    ).toThrow("invalid driver bundle digest");
  });

  test("parses Session DO evidence after the ephemeral Driver row is gone", () => {
    expect(
      parseRuntimePerformanceIdentityEvidence(
        {
          driverCreatedAt: "2026-07-19T00:00:00.000Z",
          driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
          runId: PLATFORM_ID_FIXTURES.sessionRun,
          runtimeIdentity,
          sandboxId: PLATFORM_ID_FIXTURES.sandbox,
          sandboxKind: "cattle",
          sandboxSessionId: SANDBOX_SESSION_ID,
          sandboxSubjectId: PLATFORM_ID_FIXTURES.session,
          sandboxSubjectKind: "session",
          schema: RUNTIME_PERFORMANCE_IDENTITY_EVIDENCE_SCHEMA,
          sessionId: PLATFORM_ID_FIXTURES.session,
        },
        {
          runId: PLATFORM_ID_FIXTURES.sessionRun,
          threadId: PLATFORM_ID_FIXTURES.session,
        },
      ),
    ).toMatchObject({
      driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      sandboxId: PLATFORM_ID_FIXTURES.sandbox,
      sandboxSessionId: SANDBOX_SESSION_ID,
      threadId: PLATFORM_ID_FIXTURES.session,
    });
  });

  test("builds evidence only from a complete authoritative cattle link", () => {
    const source = {
      driverCreatedAt: Date.parse("2026-07-19T00:00:00.000Z"),
      driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      runtimeIdentity,
      sandboxId: PLATFORM_ID_FIXTURES.sandbox,
      sandboxKind: "cattle",
      sandboxSessionId: SANDBOX_SESSION_ID,
      sandboxSubjectId: PLATFORM_ID_FIXTURES.session,
      sandboxSubjectKind: "session" as const,
      sessionId: PLATFORM_ID_FIXTURES.session,
    };

    expect(createSessionRuntimePerformanceIdentityEvidence(source)).toMatchObject({
      driverCreatedAt: "2026-07-19T00:00:00.000Z",
      sandboxSessionId: SANDBOX_SESSION_ID,
      schema: RUNTIME_PERFORMANCE_IDENTITY_EVIDENCE_SCHEMA,
    });
    expect(
      createSessionRuntimePerformanceIdentityEvidence({
        ...source,
        sandboxKind: "pet",
      }),
    ).toBeNull();
    expect(
      createSessionRuntimePerformanceIdentityEvidence({
        ...source,
        sandboxSubjectId: PLATFORM_ID_FIXTURES.agent,
      }),
    ).toBeNull();
  });

  test("rejects evidence with forged execution-plane ownership", () => {
    const evidence = {
      driverCreatedAt: "2026-07-19T00:00:00.000Z",
      driverInstanceId: PLATFORM_ID_FIXTURES.driverInstance,
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      runtimeIdentity,
      sandboxId: PLATFORM_ID_FIXTURES.sandbox,
      sandboxKind: "cattle",
      sandboxSessionId: SANDBOX_SESSION_ID,
      sandboxSubjectId: PLATFORM_ID_FIXTURES.agent,
      sandboxSubjectKind: "session",
      schema: RUNTIME_PERFORMANCE_IDENTITY_EVIDENCE_SCHEMA,
      sessionId: PLATFORM_ID_FIXTURES.session,
    };

    expect(() =>
      parseRuntimePerformanceIdentityEvidence(evidence, {
        runId: PLATFORM_ID_FIXTURES.sessionRun,
        threadId: PLATFORM_ID_FIXTURES.session,
      }),
    ).toThrow("non-cattle execution plane");
    expect(() =>
      parseRuntimePerformanceIdentityEvidence(
        { ...evidence, schema: "mosoo.runtime-performance-identity-evidence.v0" },
        {
          runId: PLATFORM_ID_FIXTURES.sessionRun,
          threadId: PLATFORM_ID_FIXTURES.session,
        },
      ),
    ).toThrow("unsupported schema");
  });

  test("decodes run-linked timing phases from the canonical event row", () => {
    const timing = {
      completedAtMs: 1_250,
      path: "cold" as const,
      phases: [{ durationMs: 200, name: "prepareFilesystem" }],
      runId: PLATFORM_ID_FIXTURES.sessionRun,
      sessionId: PLATFORM_ID_FIXTURES.session,
      source: "api" as const,
      stage: "prepare_run" as const,
      startedAtMs: 1_000,
      totalMs: 250,
      traceId: "trace-1",
    };

    expect(
      parseRuntimePerformanceTimingRows(
        [
          {
            contentText: serializeRuntimeTimingProcessContent(timing),
            eventId: PLATFORM_ID_FIXTURES.runtimeEvent,
            occurredAt: 1_250,
            seq: 9,
          },
        ],
        {
          runId: PLATFORM_ID_FIXTURES.sessionRun,
          threadId: PLATFORM_ID_FIXTURES.session,
        },
      ),
    ).toEqual([
      {
        eventId: PLATFORM_ID_FIXTURES.runtimeEvent,
        occurredAt: "1970-01-01T00:00:01.250Z",
        seq: 9,
        timing,
      },
    ]);
  });

  test("accepts same-Thread prewarm timing only when requested", () => {
    const timing = {
      completedAtMs: 900,
      path: "prewarm" as const,
      phases: [],
      runId: null,
      sessionId: PLATFORM_ID_FIXTURES.session,
      source: "api" as const,
      stage: "prewarm" as const,
      startedAtMs: 100,
      totalMs: 800,
      traceId: null,
    };
    const rows = [
      {
        contentText: serializeRuntimeTimingProcessContent(timing),
        eventId: PLATFORM_ID_FIXTURES.runtimeEvent,
        occurredAt: 900,
        seq: 1,
      },
    ];

    expect(() =>
      parseRuntimePerformanceTimingRows(rows, {
        runId: PLATFORM_ID_FIXTURES.sessionRun,
        threadId: PLATFORM_ID_FIXTURES.session,
      }),
    ).toThrow("source=api, stage=prewarm, path=prewarm, run=null, session=expected");
    expect(
      parseRuntimePerformanceTimingRows(rows, {
        includePrewarm: true,
        runId: PLATFORM_ID_FIXTURES.sessionRun,
        threadId: PLATFORM_ID_FIXTURES.session,
      }),
    ).toHaveLength(1);
  });

  test("accepts runless Driver backend timing as same-Thread startup evidence", () => {
    const timing = {
      completedAtMs: 950,
      path: "prewarm" as const,
      phases: [{ durationMs: 300, name: "backend.start" }],
      runId: null,
      sessionId: PLATFORM_ID_FIXTURES.session,
      source: "driver" as const,
      stage: "driver_backend" as const,
      startedAtMs: 100,
      totalMs: 850,
      traceId: null,
    };
    const rows = [
      {
        contentText: serializeRuntimeTimingProcessContent(timing),
        eventId: PLATFORM_ID_FIXTURES.runtimeEvent,
        occurredAt: 950,
        seq: 2,
      },
    ];

    expect(() =>
      parseRuntimePerformanceTimingRows(rows, {
        runId: PLATFORM_ID_FIXTURES.sessionRun,
        threadId: PLATFORM_ID_FIXTURES.session,
      }),
    ).toThrow("did not match");
    expect(
      parseRuntimePerformanceTimingRows(rows, {
        includePrewarm: true,
        runId: PLATFORM_ID_FIXTURES.sessionRun,
        threadId: PLATFORM_ID_FIXTURES.session,
      }),
    ).toEqual([
      {
        eventId: PLATFORM_ID_FIXTURES.runtimeEvent,
        occurredAt: "1970-01-01T00:00:00.950Z",
        seq: 2,
        timing,
      },
    ]);
    const coldTiming = { ...timing, path: "cold" as const };
    expect(
      parseRuntimePerformanceTimingRows(
        [{ ...rows[0], contentText: serializeRuntimeTimingProcessContent(coldTiming) }],
        {
          includePrewarm: true,
          runId: PLATFORM_ID_FIXTURES.sessionRun,
          threadId: PLATFORM_ID_FIXTURES.session,
        },
      )[0]?.timing,
    ).toEqual(coldTiming);
  });
});
