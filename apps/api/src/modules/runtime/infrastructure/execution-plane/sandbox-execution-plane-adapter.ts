import type { PtyOptions } from "@cloudflare/sandbox";
import type { SessionId } from "@mosoo/id";
import { RUNTIME_DIAGNOSTIC_EVENT } from "@mosoo/runtime-events";

import {
  disposeRpcResource,
  withDisposedRpcResource,
} from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import { createStopwatch } from "../../../../time";
import type {
  DispatchRuntimeTurnInput,
  PrepareRuntimeRunInput,
  RuntimeExecutionPlaneAdapter,
  RuntimeExecutionPlaneRunLease,
  RuntimeSubjectOperationInput,
  StopRuntimeSubjectDriversInput,
} from "../../application/execution-plane/execution-plane-adapter";
import {
  appendRuntimeDiagnosticEvent,
  toRuntimeDiagnosticBaseValue,
  toRuntimeDiagnosticReason,
} from "../../application/runtime-diagnostic-events";
import { createRuntimeTimingRecorder } from "../../application/session-runs/session-runtime-timing";
import { dispatchDriverTurn, ensureDriverSessionReady } from "../driver-session.service";
import {
  createRuntimeSubjectLifecycleService,
  getRuntimeSubjectKeepAliveHandle,
} from "../runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import { resolveRuntimeSubjectNetworkConstraints } from "../runtime-subject-lifecycle/runtime-subject-network";
import {
  recreateRuntimeSubjectPreservingState,
  resetRuntimeSubjectAgentState,
  stopRuntimeSubjectDrivers,
} from "../runtime-subject-lifecycle/runtime-subject-operations.service";
import { getRuntimeConversationSession } from "../runtime-subject-lifecycle/runtime-subject-store";
import type { ExecutionSessionHandle, SandboxHandle } from "../sandbox-handles";
import { ensureSandboxConversationSession } from "../sandbox-session.service";
import { ensureSessionResourcesMounted } from "../session-resources/session-resource-mount.service";

function releaseRunResources(handles: {
  executionSession: ExecutionSessionHandle | null;
  subject: SandboxHandle | null;
}): void {
  disposeRpcResource(handles.executionSession);
  disposeRpcResource(handles.subject);
  handles.executionSession = null;
  handles.subject = null;
}

type TerminalSessionHandle = ExecutionSessionHandle & {
  terminal(request: Request, options?: PtyOptions): Promise<Response>;
};

function isSessionAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "SessionAlreadyExistsError") {
    return true;
  }
  // workerd serializes errors across DO RPC boundaries as plain Error, dropping
  // the original class name. The wrapped message is `${originalName}: ${originalMessage}`,
  // so fall back to a message-prefix check.
  return error.message.startsWith("SessionAlreadyExistsError:");
}

function toTerminalSessionHandle(session: ExecutionSessionHandle): TerminalSessionHandle {
  if (typeof Reflect.get(session, "terminal") !== "function") {
    throw new TypeError("Cloudflare Sandbox session handle is missing terminal.");
  }

  return session as TerminalSessionHandle;
}

async function ensureTerminalSession(
  subject: SandboxHandle,
  sessionId: string,
): Promise<TerminalSessionHandle> {
  try {
    return toTerminalSessionHandle(
      await subject.createSession({
        cwd: "/workspace",
        id: sessionId,
      }),
    );
  } catch (error) {
    if (!isSessionAlreadyExistsError(error)) {
      throw error;
    }

    return toTerminalSessionHandle(await subject.getSession(sessionId));
  }
}

export async function connectPreparedSandboxTerminal(
  subject: SandboxHandle,
  input: {
    options?: PtyOptions;
    request: Request;
    terminalSessionId?: string;
  },
): Promise<Response> {
  if (input.terminalSessionId) {
    const terminalSession = await ensureTerminalSession(subject, input.terminalSessionId);
    return terminalSession.terminal(input.request, input.options);
  }

  return subject.terminal(input.request, input.options);
}

class SandboxExecutionPlaneAdapter implements RuntimeExecutionPlaneAdapter {
  async prepareRun(
    bindings: ApiBindings,
    requestUrl: string,
    input: PrepareRuntimeRunInput,
  ): Promise<RuntimeExecutionPlaneRunLease> {
    const sandboxId = input.profile.sandbox.id;
    const runtimeBase = toRuntimeDiagnosticBaseValue({
      agentId: input.profile.configRevision.agentId,
      sessionId: input.sessionId,
      traceId: input.traceId,
    });
    const sandboxProvisioningTimer = createStopwatch();
    let sandboxProvisioned = false;
    const handles: {
      executionSession: ExecutionSessionHandle | null;
      subject: SandboxHandle | null;
    } = {
      executionSession: null,
      subject: null,
    };
    // Success diagnostics are owner-debug, persist-only (deliver: false) and
    // swallow their own errors; keep them off the first-token critical path and
    // settle them before the lease is returned.
    let pendingDiagnostics: Promise<unknown> = Promise.resolve();

    try {
      const timing = createRuntimeTimingRecorder({
        runId: input.sessionRunId,
        sessionId: input.sessionId,
        source: "api",
        stage: "prepare_run",
        traceId: input.traceId,
      });
      const runtimeSubjectLifecycle = createRuntimeSubjectLifecycleService(bindings);
      pendingDiagnostics = appendRuntimeDiagnosticEvent(bindings, {
        eventName: RUNTIME_DIAGNOSTIC_EVENT.sandboxProvisioningStarted.name,
        sessionId: input.sessionId,
        value: {
          ...runtimeBase,
          sandboxId,
        },
      });
      const { subject: sandbox } = await timing.measure("activateRuntimeSubject", () =>
        runtimeSubjectLifecycle.activate({
          agentId: input.profile.agentId,
          diagnosticContext: {
            agentId: input.profile.configRevision.agentId,
            sessionId: input.sessionId,
            traceId: input.traceId,
          },
          executionOwnerUserId: input.profile.session.origin.executionOwnerUserId,
          kind: input.profile.kind,
          networkConstraints: resolveRuntimeSubjectNetworkConstraints(bindings, {
            envVars: input.profile.envVars,
            kind: input.profile.kind,
            network: input.profile.network,
            requestUrl,
            subjectKind: input.profile.sandbox.subjectKind,
          }),
          runtimeSubjectId: sandboxId,
          appId: input.profile.vendorCredential.appId,
          subjectId: input.profile.sandbox.subjectId,
          subjectKind: input.profile.sandbox.subjectKind,
          timing,
        }),
      );
      handles.subject = sandbox;
      const provisioningCompletedValue = {
        ...runtimeBase,
        coldStartMs: sandboxProvisioningTimer.elapsedMs(),
        sandboxId,
      };
      // Chain after the started event so the two diagnostics keep their order.
      pendingDiagnostics = pendingDiagnostics.then(() =>
        appendRuntimeDiagnosticEvent(bindings, {
          eventName: RUNTIME_DIAGNOSTIC_EVENT.sandboxProvisioningCompleted.name,
          sessionId: input.sessionId,
          value: provisioningCompletedValue,
        }),
      );
      sandboxProvisioned = true;

      const executionSession = await timing.measure("ensureSandboxConversationSession", () =>
        ensureSandboxConversationSession(bindings, {
          agentId: input.profile.configRevision.agentId,
          kind: input.profile.kind,
          mountSessionResources: input.attachmentIds.length > 0,
          origin: input.profile.session.origin,
          sandbox,
          sandboxId,
          sessionId: input.sessionId,
          timing,
        }),
      );
      handles.executionSession = executionSession.cloudflareSession;

      const driverProfile = {
        ...input.profile,
        session: {
          ...input.profile.session,
          sandboxSessionId: executionSession.sandboxSessionId,
          homePath: input.profile.session.homePath,
          origin: executionSession.origin,
          sessionOrganizationPath: executionSession.cwd,
        },
      };
      const driver = await timing.measure("ensureDriverSessionReady", () =>
        ensureDriverSessionReady(bindings, requestUrl, {
          builtInTools: input.builtInTools,
          cloudflareSession: executionSession.cloudflareSession,
          ...(input.onBootPayloadPrepared
            ? { onBootPayloadPrepared: input.onBootPayloadPrepared }
            : {}),
          profile: driverProfile,
          resolvedMcpServers: input.resolvedMcpServers,
          resolvedSkillCatalog: input.resolvedSkillCatalog,
          resolvedSkills: input.resolvedSkills,
          sandbox,
          sandboxSessionId: input.sessionId,
          sessionId: input.sessionId,
          sessionRunId: input.sessionRunId,
          traceId: input.traceId,
        }),
      );
      for (const phase of driver.timing.phases) {
        timing.addPhase(phase.name, phase.durationMs);
      }
      const initialDriverPhaseCount = driver.timing.phases.length;

      await pendingDiagnostics;

      return {
        driverInstanceId: driver.driverInstanceId,
        readiness: async () => {
          const driverTiming = await driver.readiness();

          for (const phase of driverTiming.phases.slice(initialDriverPhaseCount)) {
            timing.addPhase(phase.name, phase.durationMs);
          }

          return timing.snapshot({ path: driverTiming.path });
        },
        timing: timing.snapshot({ path: driver.timing.path }),
        release: () => {
          releaseRunResources(handles);
        },
      };
    } catch (error) {
      await pendingDiagnostics;
      if (!sandboxProvisioned) {
        await appendRuntimeDiagnosticEvent(bindings, {
          eventName: RUNTIME_DIAGNOSTIC_EVENT.sandboxProvisioningFailed.name,
          sessionId: input.sessionId,
          value: {
            ...runtimeBase,
            reason: toRuntimeDiagnosticReason(error, "Runtime sandbox provisioning failed."),
            sandboxId,
          },
        });
      }
      releaseRunResources(handles);
      throw error;
    }
  }

  async dispatchTurn(bindings: ApiBindings, input: DispatchRuntimeTurnInput): Promise<void> {
    await dispatchDriverTurn(bindings, input);
  }

  async materializeActiveSessionResources(
    bindings: ApiBindings,
    input: { sessionId: SessionId },
  ): Promise<void> {
    const sandboxSession = await getRuntimeConversationSession(bindings.DB, input.sessionId);

    if (sandboxSession?.status !== "active") {
      return;
    }

    await withDisposedRpcResource(
      await getRuntimeSubjectKeepAliveHandle(bindings, sandboxSession.sandboxId),
      async (sandbox) => {
        await ensureSessionResourcesMounted({
          bindings,
          sandbox,
          sessionId: input.sessionId,
        });
      },
    );
  }

  async stopSubjectDrivers(
    bindings: ApiBindings,
    input: StopRuntimeSubjectDriversInput,
  ): Promise<void> {
    await stopRuntimeSubjectDrivers(bindings, input);
  }

  async recreateSubjectPreservingState(
    bindings: ApiBindings,
    input: RuntimeSubjectOperationInput,
  ): Promise<void> {
    await recreateRuntimeSubjectPreservingState(bindings, input);
  }

  async resetSubjectAgentState(
    bindings: ApiBindings,
    input: RuntimeSubjectOperationInput,
  ): Promise<void> {
    await resetRuntimeSubjectAgentState(bindings, input);
  }
}

export function createSandboxExecutionPlaneAdapter(): RuntimeExecutionPlaneAdapter {
  return new SandboxExecutionPlaneAdapter();
}
