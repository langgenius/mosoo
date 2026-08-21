import type { CreateWorkspaceRunRequest, WorkspaceRunResponse } from "@mosoo/contracts/harness";
import type { PublicThreadApiListThreadEventsResponse } from "@mosoo/contracts/public-api";
import type { SessionRunSummary } from "@mosoo/contracts/session-run";
import { agentsTable, sessionRunsTable, sessionsTable } from "@mosoo/db";
import { isPlatformId, parsePlatformId } from "@mosoo/id";
import type { AgentId, AppId, SessionId, SessionRunId } from "@mosoo/id";
import { and, desc, eq } from "drizzle-orm";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../platform/db/drizzle";
import type { WorkspaceApiKeyCaller } from "../auth/application/workspace-api-key.service";
import { fileStore } from "../files/application/file-store";
import { getSessionExecutionPlan } from "../runtime/application/session-definition/session-execution.repository";
import { cancelRun } from "../runtime/application/session-runs/cancel-run.service";
import { createAgentSession } from "../runtime/application/session-runs/create-agent-session.service";
import { createHarnessSession } from "../runtime/application/session-runs/create-harness-session.service";
import { sendAgentSessionEvents } from "../runtime/application/session-runs/send-agent-session-events.service";
import { getSessionRunSummary } from "../runtime/infrastructure/session-runs/session-run-read.repository";
import { publicInvalidRequest, publicNotFound } from "./public-api-errors";
import {
  createPublicSessionEventStream,
  listPublicSessionEvents,
  readPublicThreadRunFinalOutput,
} from "./public-thread-events";

interface WorkspaceRunAccess {
  run: SessionRunSummary;
  sessionId: SessionId;
}

interface StartWorkspaceRunRequest {
  bindings: ApiBindings;
  caller: WorkspaceApiKeyCaller;
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  input: CreateWorkspaceRunRequest;
  requestUrl: string;
}

function createRunLinks(runId: SessionRunId) {
  const runPath = `/api/v1/runs/${runId}`;

  return {
    approve: `${runPath}/approve`,
    artifacts: `${runPath}/artifacts`,
    cancel: `${runPath}/cancel`,
    events: `${runPath}/events`,
    result: `${runPath}/result`,
    stream: `${runPath}/events/stream`,
  };
}

function toPrompt(input: CreateWorkspaceRunRequest["input"]): string {
  const prompt = typeof input === "string" ? input : JSON.stringify(input);

  if (prompt.trim().length === 0) {
    throw publicInvalidRequest("input must not be an empty string.");
  }

  return prompt;
}

async function findPublishedWorkspaceAgent(
  database: D1Database,
  workspaceId: AppId,
  reference: string,
): Promise<AgentId> {
  const normalizedReference = reference.trim();
  const idReference = normalizedReference.toUpperCase();
  const nameReference = normalizedReference.split("/").at(-1)?.trim() ?? "";
  const rows = await getAppDatabase(database)
    .select({ id: agentsTable.id })
    .from(agentsTable)
    .where(
      and(
        eq(agentsTable.appId, workspaceId),
        eq(agentsTable.status, "published"),
        isPlatformId(idReference)
          ? eq(agentsTable.id, parsePlatformId<AgentId>(idReference, "Agent ID"))
          : eq(agentsTable.name, nameReference),
      ),
    )
    .orderBy(desc(agentsTable.updatedAt))
    .limit(2)
    .all();

  if (rows.length === 0) {
    throw publicNotFound(`Published Agent ${reference} was not found in this Workspace.`);
  }

  if (rows.length > 1 && !isPlatformId(idReference)) {
    throw publicInvalidRequest(
      `Agent name ${nameReference} is ambiguous. Use the Agent ULID instead.`,
    );
  }

  return rows[0]!.id;
}

async function requireWorkspaceRunAccess(
  database: D1Database,
  caller: WorkspaceApiKeyCaller,
  runId: SessionRunId,
): Promise<WorkspaceRunAccess> {
  const row =
    (await getAppDatabase(database)
      .select({ sessionId: sessionRunsTable.sessionId })
      .from(sessionRunsTable)
      .innerJoin(sessionsTable, eq(sessionsTable.id, sessionRunsTable.sessionId))
      .where(and(eq(sessionRunsTable.id, runId), eq(sessionsTable.appId, caller.workspaceId)))
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    throw publicNotFound(`Run ${runId} was not found.`);
  }

  const run = await getSessionRunSummary(database, runId);

  if (run === null) {
    throw publicNotFound(`Run ${runId} was not found.`);
  }

  return { run, sessionId: row.sessionId };
}

async function toWorkspaceRunResponse(
  database: D1Database,
  caller: WorkspaceApiKeyCaller,
  access: WorkspaceRunAccess,
): Promise<WorkspaceRunResponse> {
  const plan = await getSessionExecutionPlan(database, access.sessionId);

  return {
    environment: {
      id: plan.environment.environmentId,
      name: plan.environment.environmentName,
      revisionId: plan.environment.revisionId,
    },
    id: access.run.id,
    links: createRunLinks(access.run.id),
    model: access.run.model ?? plan.binding.model,
    source: plan.source,
    status: access.run.status,
    threadId: access.sessionId,
    workspaceId: caller.workspaceId,
  };
}

export async function startWorkspaceRun(
  request: StartWorkspaceRunRequest,
): Promise<WorkspaceRunResponse> {
  const prompt = toPrompt(request.input.input);
  const session =
    "agent" in request.input
      ? await createAgentSession({
          bindings: request.bindings,
          executionContext: request.executionContext,
          input: {
            agentId: await findPublishedWorkspaceAgent(
              request.bindings.DB,
              request.caller.workspaceId,
              request.input.agent,
            ),
            appId: request.caller.workspaceId,
            type: "api_channel",
          },
          options: {
            participantAccountId: request.caller.viewer.id,
          },
          requestUrl: request.requestUrl,
          viewer: request.caller.viewer,
        })
      : await createHarnessSession({
          bindings: request.bindings,
          environment: request.input.environment,
          harness: request.input.harness,
          model: request.input.model,
          profile: request.input.profile,
          viewer: request.caller.viewer,
          workspaceId: request.caller.workspaceId,
        });
  const result = await sendAgentSessionEvents({
    bindings: request.bindings,
    executionContext: request.executionContext,
    input: {
      events: [{ text: prompt, type: "user_message" }],
      appId: request.caller.workspaceId,
      sessionId: session.id,
    },
    requestUrl: request.requestUrl,
    viewer: request.caller.viewer,
  });
  const run = result.events[0]?.run ?? null;

  if (run === null) {
    throw new Error("Run creation did not return a Run.");
  }

  return toWorkspaceRunResponse(request.bindings.DB, request.caller, {
    run,
    sessionId: session.id,
  });
}

export async function retrieveWorkspaceRun(
  database: D1Database,
  caller: WorkspaceApiKeyCaller,
  runId: SessionRunId,
): Promise<WorkspaceRunResponse> {
  const access = await requireWorkspaceRunAccess(database, caller, runId);
  return toWorkspaceRunResponse(database, caller, access);
}

export async function listWorkspaceRunEvents(input: {
  caller: WorkspaceApiKeyCaller;
  database: D1Database;
  limit: number;
  runId: SessionRunId;
}): Promise<PublicThreadApiListThreadEventsResponse> {
  const access = await requireWorkspaceRunAccess(input.database, input.caller, input.runId);
  return listPublicSessionEvents({
    database: input.database,
    limit: input.limit,
    sessionId: access.sessionId,
  });
}

export async function streamWorkspaceRunEvents(input: {
  bindings: ApiBindings;
  caller: WorkspaceApiKeyCaller;
  limit: number;
  runId: SessionRunId;
  signal: AbortSignal | null | undefined;
}): Promise<ReadableStream<Uint8Array>> {
  const access = await requireWorkspaceRunAccess(input.bindings.DB, input.caller, input.runId);
  return createPublicSessionEventStream({
    bindings: input.bindings,
    database: input.bindings.DB,
    limit: input.limit,
    signal: input.signal,
    sessionId: access.sessionId,
  });
}

export async function retrieveWorkspaceRunResult(input: {
  caller: WorkspaceApiKeyCaller;
  database: D1Database;
  runId: SessionRunId;
}) {
  const access = await requireWorkspaceRunAccess(input.database, input.caller, input.runId);
  return {
    output: await readPublicThreadRunFinalOutput({
      database: input.database,
      runId: input.runId,
      sessionId: access.sessionId,
    }),
    run: await toWorkspaceRunResponse(input.database, input.caller, access),
  };
}

export async function listWorkspaceRunArtifacts(input: {
  bindings: ApiBindings;
  caller: WorkspaceApiKeyCaller;
  runId: SessionRunId;
}) {
  const access = await requireWorkspaceRunAccess(input.bindings.DB, input.caller, input.runId);
  const listing = await fileStore.list(input.bindings, input.caller.viewer, {
    appId: input.caller.workspaceId,
    scopeKind: "session",
    sessionId: access.sessionId,
    sessionKind: "artifact",
  });

  return {
    artifacts: listing.files.map((file) => ({
      createdAt: file.createdAt,
      id: file.id,
      mimeType: file.mimeType,
      name: file.name,
      size: file.size,
    })),
  };
}

export async function approveWorkspaceRun(input: {
  bindings: ApiBindings;
  caller: WorkspaceApiKeyCaller;
  decision: "allow_once" | "reject_once";
  executionContext: Pick<ExecutionContext, "waitUntil"> | null;
  requestId: string;
  requestUrl: string;
  runId: SessionRunId;
}): Promise<{ ok: true }> {
  const access = await requireWorkspaceRunAccess(input.bindings.DB, input.caller, input.runId);
  await sendAgentSessionEvents({
    bindings: input.bindings,
    executionContext: input.executionContext,
    input: {
      events: [
        {
          decision: input.decision,
          requestId: input.requestId,
          type: "permission_decision",
        },
      ],
      appId: input.caller.workspaceId,
      sessionId: access.sessionId,
    },
    requestUrl: input.requestUrl,
    viewer: input.caller.viewer,
  });
  return { ok: true };
}

export async function cancelWorkspaceRun(input: {
  bindings: ApiBindings;
  caller: WorkspaceApiKeyCaller;
  runId: SessionRunId;
}): Promise<WorkspaceRunResponse> {
  const access = await requireWorkspaceRunAccess(input.bindings.DB, input.caller, input.runId);
  const cancelled = await cancelRun(input.bindings, input.caller.viewer, {
    appId: input.caller.workspaceId,
    runId: input.runId,
    sessionId: access.sessionId,
  });

  return toWorkspaceRunResponse(input.bindings.DB, input.caller, {
    run: cancelled.run,
    sessionId: access.sessionId,
  });
}
