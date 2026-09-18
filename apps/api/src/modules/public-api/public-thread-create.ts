import type { PublicThreadApiCreateThreadResponse } from "@mosoo/contracts/public-api";
import type { SessionSummary } from "@mosoo/contracts/session";
import { createPlatformId } from "@mosoo/id";
import type { FileId, SessionId } from "@mosoo/id";

import { createErrorLogContext, logError } from "../../platform/cloudflare/logger";
import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import { API_ERROR_CODE, isApiError } from "../../platform/errors";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { fileStore } from "../files/application/file-store";
import { createAgentSession, queueSessionRun } from "../runtime/application/session-run.service";
import { admitPublicThreadCreator } from "./public-thread-admission";
import type { ThreadCreationAdmission } from "./public-thread-admission";
import { toPublicThreadSessionSummary } from "./public-thread-api-presenter";
import { toPublicThreadId } from "./public-thread-ids";
import { createPublicApiThreadMetadata } from "./public-thread-metadata";
import {
  toCreateEmptyThreadSessionSummary,
  toCreateThreadResponse,
  toCreateThreadSessionSummary,
} from "./public-thread-presenter";
import {
  cleanupFailedThreadCreation,
  findPublicThreadSnapshotByIdempotencyKey,
  getThreadSnapshot,
  getPublicThreadInitialRun,
  setSessionTitleFromThreadPrompt,
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

async function ensureThreadFilesClaimable(input: {
  admission: ThreadCreationAdmission;
  bindings: ApiBindings;
  fileIds: FileId[];
  sessionId: SessionId;
}): Promise<void> {
  if (input.fileIds.length === 0) {
    return;
  }

  await fileStore.ensureClaimable(
    input.bindings,
    input.admission.fileViewer,
    input.sessionId,
    input.fileIds,
  );
}

async function startInitialThreadRun(
  request: CreatePublicThreadRequest,
  admission: ThreadCreationAdmission,
  session: SessionSummary,
  prompt: string,
  clientRequestId: string,
): Promise<PublicThreadApiCreateThreadResponse<string | null>> {
  const sessionId = session.id;
  const queuedRun = await queueSessionRun({
    bindings: request.bindings,
    executionContext: request.executionContext ?? null,
    input: {
      accessViewer: admission.accessViewer,
      attachmentIds: request.input.fileIds,
      clientRequestId,
      prompt,
      session: {
        agent_id: session.agentId,
        deployment_version_id: session.deploymentVersionId,
        deployment_version_number: session.deploymentVersionNumber,
        id: sessionId,
        model: session.model,
        project_id: session.projectId,
        provider: session.provider,
        runtime_id: session.runtimeId,
      },
    },
    requestUrl: request.requestUrl,
    viewer: admission.creatorViewer,
  });
  const run = queuedRun.run;
  const runSessionState = queuedRun.sessionState;

  const titleUpdate = await setSessionTitleFromThreadPrompt({
    database: request.bindings.DB,
    prompt,
    sessionId,
  });

  const updatedSession = toCreateThreadSessionSummary({
    run,
    session,
    sessionState: runSessionState,
    titleUpdate,
  });

  return toCreateThreadResponse({
    apiVersion: request.apiVersion,
    endUserId: request.input.userId,
    run,
    session: updatedSession,
  });
}

export async function createPublicThread(
  request: CreatePublicThreadRequest,
): Promise<PublicThreadApiCreateThreadResponse<string | null>> {
  const admission = await admitPublicThreadCreator(request.bindings.DB, request.caller, {
    agentId: request.agentId,
    apiVersion: request.apiVersion,
  });
  let createdSessionId: SessionId | null = null;
  let durableMutationStarted = false;
  const initialRequestId = createPlatformId();
  const metadata = createPublicApiThreadMetadata({
    apiVersion: request.apiVersion,
    createdBy: admission.createdBy,
    idempotencyKey: request.idempotencyKey,
  });

  try {
    const session = await createAgentSession({
      bindings: request.bindings,
      executionContext: request.executionContext,
      input: {
        agentId: request.agentId,
        projectId: admission.projectId,
        type: "ui",
      },
      options: {
        accessViewer: admission.accessViewer,
        ...(request.apiVersion === "v2" ? { configurationSource: "saved" as const } : {}),
        endUserId: request.input.userId,
        metadata: {
          public_api: metadata,
          // Outside the legacy public_api envelope so older readers can still
          // recognize this Session during an application rollback.
          public_api_initial_request_id:
            request.input.inputText === undefined ? null : initialRequestId,
        },
      },
      ...(request.input.inputText === undefined ? { requestUrl: request.requestUrl } : {}),
      viewer: admission.creatorViewer,
    });
    const sessionId = session.id;
    createdSessionId = sessionId;

    await ensureThreadFilesClaimable({
      admission,
      bindings: request.bindings,
      fileIds: request.input.fileIds,
      sessionId,
    });

    // A failed response does not prove that file claim or turn admission rolled
    // back. Retain their Session so a retry can reconcile the committed state.
    durableMutationStarted = true;
    await claimThreadFiles({
      bindings: request.bindings,
      fileIds: request.input.fileIds,
      sessionId,
      viewer: admission.fileViewer,
    });

    if (request.input.inputText === undefined) {
      return toCreateThreadResponse({
        apiVersion: request.apiVersion,
        endUserId: request.input.userId,
        run: null,
        session: toCreateEmptyThreadSessionSummary(session),
      });
    }

    return await startInitialThreadRun(
      request,
      admission,
      session,
      request.input.inputText,
      initialRequestId,
    );
  } catch (error) {
    if (createdSessionId !== null && !durableMutationStarted) {
      await cleanupFailedThreadCreation({
        bindings: request.bindings,
        fileIds: request.input.fileIds,
        sessionId: createdSessionId,
      }).catch((cleanupError: unknown) => {
        logError("public-api.thread.cleanup_failed", {
          ...createErrorLogContext(cleanupError),
          sessionId: createdSessionId,
        });
      });
    }

    throw error;
  }
}

export async function recoverPublicThreadCreation(
  request: CreatePublicThreadRequest,
): Promise<PublicThreadApiCreateThreadResponse<string | null> | null> {
  if (request.idempotencyKey === null) {
    return null;
  }

  const admission = await admitPublicThreadCreator(request.bindings.DB, request.caller, {
    agentId: request.agentId,
    apiVersion: request.apiVersion,
  });
  let snapshot = await findPublicThreadSnapshotByIdempotencyKey(request.bindings.DB, {
    agentId: request.agentId,
    apiVersion: request.apiVersion,
    idempotencyKey: request.idempotencyKey,
    tokenId: admission.createdBy.token_id,
    createdAfterMs: request.idempotencyCreatedAt,
    ...(admission.creatorViewer.projectId === undefined
      ? {}
      : { projectId: admission.creatorViewer.projectId }),
  });

  if (!snapshot) {
    return null;
  }

  const initialRequestId = snapshot.metadata?.initial_request_id;
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
      viewer: admission.fileViewer,
      resume: true,
    });
    if (request.input.inputText !== undefined) {
      try {
        return await startInitialThreadRun(
          request,
          admission,
          snapshot.session,
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
        snapshot = await getThreadSnapshot(
          request.bindings.DB,
          toPublicThreadId(snapshot.session.id),
          request.apiVersion,
        );
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
    run: initialRun,
    session: toPublicThreadSessionSummary(snapshot.session),
  });
}
