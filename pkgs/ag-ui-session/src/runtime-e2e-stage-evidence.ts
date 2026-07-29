import type { AgUiSessionEvent } from "./ag-ui-session-events";

export const RUNTIME_E2E_STAGE_EVIDENCE_KEY = "mosooRuntimeE2E";
export const RUNTIME_E2E_STAGE_EVIDENCE_SCHEMA = "mosoo.runtime-e2e-stage-evidence.v1";

export interface RuntimeE2EObservedAt {
  readonly clockDomain: string;
  readonly epochMs: number;
}

export interface RuntimeE2EStageEvidence {
  readonly correlationId: string;
  readonly d1Commit: RuntimeE2EObservedAt;
  readonly providerFirstDelta: RuntimeE2EObservedAt;
  readonly runId: string;
  readonly schema: typeof RUNTIME_E2E_STAGE_EVIDENCE_SCHEMA;
  readonly sessionId: string;
  readonly sourceEventId: string;
  readonly traceId: string | null;
  readonly viewerPublish?: RuntimeE2EObservedAt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Runtime E2E stage evidence requires ${field}.`);
  }

  return value;
}

function readObservedAt(value: unknown, label: string): RuntimeE2EObservedAt {
  if (!isRecord(value)) {
    throw new Error(`Runtime E2E stage evidence ${label} must be an object.`);
  }

  const clockDomain = requireString(value, "clockDomain");
  const epochMs = value["epochMs"];

  if (typeof epochMs !== "number" || !Number.isFinite(epochMs) || epochMs < 0) {
    throw new Error(`Runtime E2E stage evidence ${label}.epochMs must be finite.`);
  }

  return { clockDomain, epochMs };
}

export function parseRuntimeE2EStageEvidence(value: unknown): RuntimeE2EStageEvidence {
  if (!isRecord(value) || value["schema"] !== RUNTIME_E2E_STAGE_EVIDENCE_SCHEMA) {
    throw new Error("Runtime E2E stage evidence has an unsupported schema.");
  }

  const sourceEventId = requireString(value, "sourceEventId");
  const correlationId = requireString(value, "correlationId");

  if (correlationId !== sourceEventId) {
    throw new Error("Runtime E2E stage evidence correlation must use sourceEventId.");
  }

  const traceId = value["traceId"];
  if (traceId !== null && typeof traceId !== "string") {
    throw new Error("Runtime E2E stage evidence traceId must be a string or null.");
  }

  return {
    correlationId,
    d1Commit: readObservedAt(value["d1Commit"], "d1Commit"),
    providerFirstDelta: readObservedAt(value["providerFirstDelta"], "providerFirstDelta"),
    runId: requireString(value, "runId"),
    schema: RUNTIME_E2E_STAGE_EVIDENCE_SCHEMA,
    sessionId: requireString(value, "sessionId"),
    sourceEventId,
    traceId,
    ...(value["viewerPublish"] === undefined
      ? {}
      : { viewerPublish: readObservedAt(value["viewerPublish"], "viewerPublish") }),
  };
}

export function readRuntimeE2EStageEvidence(
  event: AgUiSessionEvent,
): RuntimeE2EStageEvidence | null {
  if (!isRecord(event.rawEvent)) {
    return null;
  }

  const value = event.rawEvent[RUNTIME_E2E_STAGE_EVIDENCE_KEY];
  return value === undefined ? null : parseRuntimeE2EStageEvidence(value);
}

export function withRuntimeE2EStageEvidence(
  event: AgUiSessionEvent,
  evidence: RuntimeE2EStageEvidence,
): AgUiSessionEvent {
  return {
    ...event,
    rawEvent: {
      ...(isRecord(event.rawEvent) ? event.rawEvent : {}),
      [RUNTIME_E2E_STAGE_EVIDENCE_KEY]: evidence,
    },
  };
}
