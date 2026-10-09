import type { AgentKind } from "@mosoo/contracts/agent";
import type { PublicApiVersion } from "@mosoo/contracts/public-api";
import type { PublicThreadApiCreateThreadResponse } from "@mosoo/contracts/public-api";
import type { SessionSummary } from "@mosoo/contracts/session";
import { createPlatformId } from "@mosoo/id";
import type { FileId, SessionId } from "@mosoo/id";

import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { API_ERROR_CODE, isApiError } from "../../platform/errors";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { fileStore } from "../files/application/file-store";
import {
  autoTitleSessionFromPrompt,
  createAgentSession,
  createProjectSession,
  queueSessionRun,
} from "../runtime/application/session-run.service";
import { admitAgentApiEndpointCaller } from "./agent-api-endpoint-admission.service";
import { publicInvalidRequest } from "./public-api-errors";
import { admitPublicProjectCaller } from "./public-thread-admission";
import { toCreateThreadResponse } from "./public-thread-presenter";
import { admitPublicThread } from "./public-thread-session-query.service";
import {
  findPublicThreadSnapshotByIdempotencyKey,
  getPublicThreadInitialRun,
} from "./public-thread-store";
import type { CreatePublicThreadRequest } from "./public-thread.types";

async function claimThreadFiles(input: {
  bindings: ApiBindings;
  fileIds: FileId[];
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
  resume?: boolean;
}): Promise<void> {
  if (input.fileIds.length === 0) {
    return;
  }

  await fileStore.claimToSession(input.bindings, input.viewer, input.sessionId, input.fileIds, {
    resume: input.resume === true,
  });
}

async function startInitialThreadRun(
  request: CreatePublicThreadRequest,
  session: SessionSummary,
  legacyKind: AgentKind,
  prompt: string,
  clientRequestId: string,
): Promise<PublicThreadApiCreateThreadResponse<string | null, PublicApiVersion>> {
  const { run, sessionState } = await queueSessionRun({
    bindings: request.bindings,
    executionContext: request.executionContext ?? null,
    input: {
      attachmentIds: request.input.fileIds,
      clientRequestId,
      prompt,
      session,
    },
    requestUrl: request.requestUrl,
    viewer: request.caller.viewer,
  });
  const titleUpdate = await autoTitleSessionFromPrompt({
    database: request.bindings.DB,
    sessionId: session.id,
    text: prompt,
  });

  return toCreateThreadResponse({
    apiVersion: request.apiVersion,
    endUserId: request.input.userId,
    legacyKind,
    run,
    session: {
      ...session,
      ...titleUpdate,
      lastRun: run,
      status: sessionState.status,
    },
  });
}

export async function createPublicThread(
  request: CreatePublicThreadRequest,
): Promise<PublicThreadApiCreateThreadResponse<string | null, PublicApiVersion>> {
  if (request.source.type === "inline" && request.apiVersion !== "v2") {
    throw publicInvalidRequest("Inline execution requires API v2.");
  }
  // The v2 route admits the caller to the inline Session's Project before creation.
  const projectId =
    request.source.type === "inline"
      ? request.source.projectId
      : await admitAgentApiEndpointCaller(
          request.bindings.DB,
          request.caller.viewer,
          request.source.agentId,
          request.apiVersion,
        );
  const initialRequestId = createPlatformId();

  await fileStore.ensureClaimable(
    request.bindings,
    request.caller.viewer,
    projectId,
    request.input.fileIds,
  );

  const creation = {
    bindings: request.bindings,
    executionContext: request.executionContext,
    options: {
      ...(request.apiVersion === "v2" ? { configurationSource: "saved" as const } : {}),
      endUserId: request.input.userId,
      metadata: {
        public_api: {
          ...(request.apiVersion === "v2" ? { api_version: request.apiVersion } : {}),
          created_by: {
            token_id: request.caller.tokenId,
            token_label: request.caller.tokenLabel,
          },
          idempotency_key: request.idempotencyKey,
          source: "public_api" as const,
        },
        // Outside the legacy public_api envelope so older readers can still
        // recognize this Session during an application rollback.
        public_api_initial_request_id:
          request.input.inputText === undefined ? null : initialRequestId,
      },
    },
    viewer: request.caller.viewer,
  };
  const session =
    request.source.type === "inline"
      ? await createProjectSession({ ...creation, input: request.source })
      : await createAgentSession({
          ...creation,
          input: { agentId: request.source.agentId, projectId, type: "ui" },
        });

  await claimThreadFiles({
    bindings: request.bindings,
    fileIds: request.input.fileIds,
    sessionId: session.id,
    viewer: request.caller.viewer,
  });

  if (request.input.inputText === undefined) {
    // File admission can still reject this request. Start runtime work only
    // after the complete request has passed and its attachments are claimed.
    const { scheduleAgentSessionRuntimePrewarm } =
      await import("../runtime/application/session-runs/prewarm-agent-session-runtime.service");
    scheduleAgentSessionRuntimePrewarm({
      bindings: request.bindings,
      executionContext: request.executionContext ?? null,
      requestUrl: request.requestUrl,
      session,
      viewer: request.caller.viewer,
    });
    return toCreateThreadResponse({
      apiVersion: request.apiVersion,
      endUserId: request.input.userId,
      legacyKind: "cattle",
      run: null,
      session,
    });
  }

  return startInitialThreadRun(
    request,
    session,
    "cattle", // New Session rows retain this inert value for v1 compatibility.
    request.input.inputText,
    initialRequestId,
  );
}

export async function recoverPublicThreadCreation(
  request: CreatePublicThreadRequest,
): Promise<PublicThreadApiCreateThreadResponse<string | null, PublicApiVersion> | null> {
  if (request.idempotencyKey === null) {
    return null;
  }

  if (request.source.type === "inline" && request.apiVersion !== "v2") {
    throw publicInvalidRequest("Inline execution requires API v2.");
  }
  // v2 recovery authorizes the frozen Session's Project, even when its optional
  // preset has been edited or removed since the first admitted request.
  if (request.apiVersion !== "v2" && request.source.type === "agent") {
    await admitAgentApiEndpointCaller(
      request.bindings.DB,
      request.caller.viewer,
      request.source.agentId,
      request.apiVersion,
    );
  }
  let snapshot = await findPublicThreadSnapshotByIdempotencyKey(request.bindings.DB, {
    agentId: request.source.type === "agent" ? request.source.agentId : null,
    apiVersion: request.apiVersion,
    idempotencyKey: request.idempotencyKey,
    tokenId: request.caller.tokenId,
    createdAfterMs: request.idempotencyCreatedAt,
    ...(request.source.type === "inline"
      ? { projectId: request.source.projectId }
      : request.caller.viewer.projectId === undefined
        ? {}
        : { projectId: request.caller.viewer.projectId }),
  });

  if (!snapshot) {
    return null;
  }
  if (request.apiVersion === "v2") {
    await admitPublicProjectCaller(
      request.bindings.DB,
      request.caller.viewer,
      snapshot.session.projectId,
    );
  }

  const { initialRequestId } = snapshot;
  let initialRun =
    initialRequestId === undefined
      ? snapshot.session.lastRun // Pending requests admitted before creation receipts existed.
      : initialRequestId === null
        ? null
        : await getPublicThreadInitialRun(
            request.bindings.DB,
            snapshot.session.id,
            initialRequestId,
          );

  if (initialRun === null) {
    await claimThreadFiles({
      bindings: request.bindings,
      fileIds: request.input.fileIds,
      sessionId: snapshot.session.id,
      viewer: request.caller.viewer,
      resume: true,
    });
    if (request.input.inputText !== undefined) {
      try {
        return await startInitialThreadRun(
          request,
          snapshot.session,
          snapshot.kind,
          request.input.inputText,
          initialRequestId ?? "public-api:initial-turn",
        );
      } catch (error) {
        if (
          !isApiError(error) ||
          (error.code !== API_ERROR_CODE.sessionRunClientRequestDuplicate &&
            error.code !== API_ERROR_CODE.sessionRunActive)
        )
          throw error;
        // Another recovery won admission. Re-read it; the Session-scoped receipt
        // also prevents duplication if that turn finishes before this attempt.
        snapshot = {
          ...(await admitPublicThread(
            request.bindings.DB,
            request.caller.viewer,
            snapshot.session.id,
            request.apiVersion,
          )),
          initialRequestId,
        };
        initialRun = await getPublicThreadInitialRun(
          request.bindings.DB,
          snapshot.session.id,
          initialRequestId ?? "public-api:initial-turn",
        );
        if (initialRun === null) throw error;
      }
    }
  }

  return toCreateThreadResponse({
    apiVersion: request.apiVersion,
    endUserId: snapshot.endUserId,
    legacyKind: snapshot.kind,
    run: initialRun,
    session: snapshot.session,
  });
}
