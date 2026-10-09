import type { DriverInstanceId, FileId, SessionId, SessionRunId } from "@mosoo/id";

import { disposeRpcResource } from "../../../../platform/cloudflare/rpc-disposal";
import type { ApiBindings } from "../../../../platform/cloudflare/worker-types";
import type { HydratedSessionRunContext } from "../../application/session-definition/session-execution.types";
import { createRuntimeTimingRecorder } from "../../application/session-runs/session-runtime-timing";
import type { RuntimeTimingSnapshot } from "../../application/session-runs/session-runtime-timing";
import { ensureDriverSessionReady } from "../driver-session.service";
import { activateRuntimeSubject } from "../runtime-subject-lifecycle/runtime-subject-lifecycle.service";
import { resolveRuntimeSubjectNetworkConstraints } from "../runtime-subject-lifecycle/runtime-subject-network";
import type { ExecutionSessionHandle, SandboxHandle } from "../sandbox-handles";
import { ensureSandboxConversationSession } from "../sandbox-session/sandbox-conversation-session.service";

export interface RuntimeExecutionPlaneRunLease {
  driverInstanceId: DriverInstanceId;
  timing: RuntimeTimingSnapshot;
  readiness(): Promise<RuntimeTimingSnapshot>;
  release(): void;
}

export interface PrepareRuntimeRunInput {
  attachmentIds: FileId[];
  builtInTools: HydratedSessionRunContext["builtInTools"];
  profile: HydratedSessionRunContext["profile"];
  resolvedMcpServers: HydratedSessionRunContext["mcpServers"];
  resolvedSkillCatalog: HydratedSessionRunContext["skillCatalog"];
  resolvedSkills: HydratedSessionRunContext["skills"];
  sessionId: SessionId;
  sessionRunId: SessionRunId;
  traceId: string;
}

function releaseRunResources(handles: {
  executionSession: ExecutionSessionHandle | null;
  subject: SandboxHandle | null;
}): void {
  disposeRpcResource(handles.executionSession);
  disposeRpcResource(handles.subject);
  handles.executionSession = null;
  handles.subject = null;
}

export async function prepareRun(
  bindings: ApiBindings,
  requestUrl: string,
  input: PrepareRuntimeRunInput,
): Promise<RuntimeExecutionPlaneRunLease> {
  const sandboxId = input.profile.sandbox.id;
  const handles: {
    executionSession: ExecutionSessionHandle | null;
    subject: SandboxHandle | null;
  } = {
    executionSession: null,
    subject: null,
  };

  try {
    const timing = createRuntimeTimingRecorder({
      runId: input.sessionRunId,
      sessionId: input.sessionId,
      source: "api",
      stage: "prepare_run",
      traceId: input.traceId,
    });
    const sandbox = await timing.measure("activateRuntimeSubject", () =>
      activateRuntimeSubject(bindings, {
        agentId: input.profile.agentId,
        executionOwnerUserId: input.profile.session.origin.executionOwnerUserId,
        networkConstraints: resolveRuntimeSubjectNetworkConstraints(bindings, {
          envVars: input.profile.envVars,
          network: input.profile.network,
          requestUrl,
        }),
        runtimeSubjectId: sandboxId,
        projectId: input.profile.vendorCredential.projectId,
        sessionId: input.sessionId,
        timing,
      }),
    );
    handles.subject = sandbox;

    const executionSession = await timing.measure("ensureSandboxConversationSession", () =>
      ensureSandboxConversationSession(bindings, {
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
        profile: driverProfile,
        resolvedMcpServers: input.resolvedMcpServers,
        resolvedSkillCatalog: input.resolvedSkillCatalog,
        resolvedSkills: input.resolvedSkills,
        sandbox,
        sessionId: input.sessionId,
        sessionRunId: input.sessionRunId,
        traceId: input.traceId,
      }),
    );
    for (const phase of driver.timing.phases) {
      timing.addPhase(phase.name, phase.durationMs);
    }
    const initialDriverPhaseCount = driver.timing.phases.length;

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
    releaseRunResources(handles);
    throw error;
  }
}
