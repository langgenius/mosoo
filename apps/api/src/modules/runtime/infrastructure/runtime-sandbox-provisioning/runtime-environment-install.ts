import type { EnvironmentRevisionId, SessionId } from "@mosoo/id";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";

import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { createStopwatch } from "../../../../time";
import type { Stopwatch } from "../../../../time";
import {
  appendRuntimeDiagnosticEvent,
  appendRuntimeDiagnosticEvents,
  toRuntimeDiagnosticReason,
} from "../../application/runtime-diagnostic-events";
import type { RuntimeTimingRecorder } from "../../application/session-runs/session-runtime-timing";
import type { DriverProfileConfig } from "../../domain/driver-snapshot";
import type { ExecutionSessionHandle } from "../sandbox-handles";
import {
  ensureProvisioningDirectories,
  ensureRuntimeMemoryMounts,
  runSetupScript,
} from "./runtime-driver-files.service";

interface RuntimeDiagnosticBaseValue {
  readonly agentId: string;
  readonly sessionId: string;
  readonly traceId?: string | null;
}

export interface RuntimeEnvironmentInstallState {
  completed: boolean;
  startedEvents: Promise<boolean> | null;
  timer: Stopwatch | null;
}

export function createRuntimeEnvironmentInstallState(): RuntimeEnvironmentInstallState {
  return {
    completed: false,
    startedEvents: null,
    timer: null,
  };
}

export async function installRuntimeEnvironment(
  env: ApiBindings,
  input: {
    readonly cloudflareSession: ExecutionSessionHandle;
    readonly environmentRevisionId: EnvironmentRevisionId;
    readonly profile: DriverProfileConfig;
    readonly runtimeBase: RuntimeDiagnosticBaseValue;
    readonly sessionId: SessionId;
    readonly state: RuntimeEnvironmentInstallState;
    readonly timing: RuntimeTimingRecorder;
  },
): Promise<void> {
  input.state.timer = createStopwatch();
  input.state.startedEvents = appendRuntimeDiagnosticEvents(env, {
    events: [
      {
        eventName: RUNTIME_DIAGNOSTIC_EVENT.provisioningEnvironmentResolving.name,
        value: {
          ...input.runtimeBase,
          environmentRevisionId: input.environmentRevisionId,
        },
      },
      {
        eventName: RUNTIME_DIAGNOSTIC_EVENT.provisioningEnvironmentInstallStarted.name,
        value: {
          ...input.runtimeBase,
          environmentRevisionId: input.environmentRevisionId,
        },
      },
    ],
    sessionId: input.sessionId,
  });
  void input.state.startedEvents.catch(() => undefined);

  await input.timing.measure("materializeDriverFiles", () =>
    Promise.all([
      ensureProvisioningDirectories(input.cloudflareSession, input.profile),
      ensureRuntimeMemoryMounts(input.cloudflareSession, input.profile),
    ]).then(() => undefined),
  );
  await input.timing.measure("runSetupScript", () =>
    runSetupScript(input.cloudflareSession, input.profile),
  );
  input.state.completed = true;
  await input.state.startedEvents;
  await appendRuntimeDiagnosticEvent(env, {
    eventName: RUNTIME_DIAGNOSTIC_EVENT.provisioningEnvironmentInstallCompleted.name,
    sessionId: input.sessionId,
    value: {
      ...input.runtimeBase,
      elapsedMs: input.state.timer.elapsedMs(),
      environmentRevisionId: input.environmentRevisionId,
    },
  });
}

export async function waitForRuntimeEnvironmentStartedEvents(
  state: RuntimeEnvironmentInstallState,
): Promise<void> {
  await (state.startedEvents?.catch(() => undefined) ?? Promise.resolve(false));
}

export async function appendRuntimeEnvironmentInstallFailed(
  env: ApiBindings,
  input: {
    readonly environmentRevisionId: EnvironmentRevisionId;
    readonly error: unknown;
    readonly runtimeBase: RuntimeDiagnosticBaseValue;
    readonly sessionId: SessionId;
    readonly state: RuntimeEnvironmentInstallState;
  },
): Promise<void> {
  if (input.state.timer === null || input.state.completed) {
    return;
  }

  await appendRuntimeDiagnosticEvent(env, {
    eventName: RUNTIME_DIAGNOSTIC_EVENT.provisioningEnvironmentInstallFailed.name,
    sessionId: input.sessionId,
    value: {
      ...input.runtimeBase,
      environmentRevisionId: input.environmentRevisionId,
      reason: toRuntimeDiagnosticReason(input.error, "Runtime environment install failed."),
    },
  });
}
