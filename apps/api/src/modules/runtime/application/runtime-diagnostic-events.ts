import { createPlatformId } from "@mosoo/id";
import type { AgentDeploymentVersionId, AgentId, SessionId } from "@mosoo/id";
import { createRuntimeEvent, readRuntimeDiagnosticEventDefinition } from "@mosoo/runtime-events";
import type { RuntimeEventEnvelope } from "@mosoo/runtime-events";
import type {
  RuntimeDiagnosticEventDefinition,
  RuntimeDiagnosticEventName,
  RuntimeDiagnosticEventValue,
} from "@mosoo/runtime-events";

import { createErrorLogContext, logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../time";
import {
  appendOneSessionRuntimeEventPerSession,
  appendSessionRuntimeEvents,
} from "../../sessions/application/session-event-write.service";

export interface RuntimeDiagnosticContext {
  agentId: AgentId;
  deploymentVersion?: {
    id: AgentDeploymentVersionId;
    versionNumber: number;
  } | null;
  sessionId: SessionId;
  traceId?: string | null;
}

export interface RuntimeDiagnosticEventInput<
  TName extends RuntimeDiagnosticEventName = RuntimeDiagnosticEventName,
> {
  eventName: TName;
  value: RuntimeDiagnosticEventValue<TName>;
}

export interface RuntimeDiagnosticSessionEventInput<
  TName extends RuntimeDiagnosticEventName = RuntimeDiagnosticEventName,
> extends RuntimeDiagnosticEventInput<TName> {
  sessionId: SessionId;
}

export function toRuntimeDiagnosticBaseValue(input: RuntimeDiagnosticContext): {
  agentId: string;
  deploymentVersionId?: string;
  deploymentVersionNumber?: number;
  sessionId: string;
  traceId?: string | null;
} {
  return {
    agentId: input.agentId,
    ...(input.deploymentVersion
      ? {
          deploymentVersionId: input.deploymentVersion.id,
          deploymentVersionNumber: input.deploymentVersion.versionNumber,
        }
      : {}),
    sessionId: input.sessionId,
    ...(input.traceId !== undefined ? { traceId: input.traceId } : {}),
  };
}

export function toRuntimeDiagnosticReason(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return fallback;
}

export async function appendRuntimeDiagnosticEvent<TName extends RuntimeDiagnosticEventName>(
  bindings: ApiBindings,
  input: {
    eventName: TName;
    sessionId: SessionId;
    value: RuntimeDiagnosticEventValue<TName>;
  },
): Promise<boolean> {
  return appendRuntimeDiagnosticEvents(bindings, {
    events: [{ eventName: input.eventName, value: input.value }],
    sessionId: input.sessionId,
  });
}

export async function appendRuntimeDiagnosticEvents(
  bindings: ApiBindings,
  input: {
    events: RuntimeDiagnosticEventInput[];
    sessionId: SessionId;
  },
): Promise<boolean> {
  if (input.events.length === 0) {
    return true;
  }

  try {
    await appendSessionRuntimeEvents({
      bindings,
      deliver: false,
      events: input.events.map((event) =>
        createRuntimeDiagnosticSessionEvent({
          eventName: event.eventName,
          sessionId: input.sessionId,
          value: event.value,
        }),
      ),
      sessionId: input.sessionId,
    });
    return true;
  } catch (error) {
    logWarn("runtime.diagnostic_event.append_failed", {
      ...createErrorLogContext(error),
      eventCount: input.events.length,
      sessionId: input.sessionId,
    });
    return false;
  }
}

export async function appendOneRuntimeDiagnosticEventPerSession(
  bindings: ApiBindings,
  input: {
    events: readonly RuntimeDiagnosticSessionEventInput[];
  },
): Promise<boolean> {
  if (input.events.length === 0) {
    return true;
  }

  try {
    const result = await appendOneSessionRuntimeEventPerSession({
      bindings,
      deliver: false,
      records: input.events.map((event) => ({
        event: createRuntimeDiagnosticSessionEvent(event),
        sessionId: event.sessionId,
      })),
    });

    if (result.skippedSessionIds.length > 0) {
      logWarn("runtime.diagnostic_event.batch_missing_sessions", {
        eventCount: input.events.length,
        sessionIds: result.skippedSessionIds,
      });
    }

    return result.persistedCount === input.events.length && result.skippedSessionIds.length === 0;
  } catch (error) {
    logWarn("runtime.diagnostic_event.batch_append_failed", {
      ...createErrorLogContext(error),
      eventCount: input.events.length,
      sessionCount: new Set(input.events.map((event) => event.sessionId)).size,
    });
    return false;
  }
}

function createRuntimeDiagnosticSessionEvent<TName extends RuntimeDiagnosticEventName>(
  input: RuntimeDiagnosticSessionEventInput<TName>,
): RuntimeEventEnvelope {
  const occurredAtMs = currentTimestampMs();
  const definition = readRuntimeDiagnosticEventDefinition(input.eventName);

  return createRuntimeEvent({
    actor: "system",
    id: createPlatformId(),
    kind: definition.kind,
    occurredAt: new Date(occurredAtMs).toISOString(),
    origin: "system",
    payload: createRuntimeDiagnosticPayload(definition, input.value),
    sessionId: input.sessionId,
    visibility: "owner_debug",
  });
}

function createRuntimeDiagnosticPayload(
  definition: RuntimeDiagnosticEventDefinition,
  detail: unknown,
):
  | { channel: string; detail: unknown; status: string }
  | { detail: unknown; phase: string; status: string } {
  if (definition.kind === "runtime.transport.updated") {
    return {
      channel: definition.phase,
      detail,
      status: definition.status,
    };
  }

  return {
    detail,
    phase: definition.phase,
    status: definition.status,
  };
}
