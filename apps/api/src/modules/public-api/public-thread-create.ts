import type { PublicThreadApiCreateThreadResponse } from "@mosoo/contracts/public-api";
import type { FileId, SessionId } from "@mosoo/id";

import { createErrorLogContext, logError } from "../../platform/cloudflare/logger";
import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import { fileStore } from "../files/application/file-store";
import { createAgentSession, queueSessionRun } from "../runtime/application/session-run.service";
import { admitPublicThreadCreator } from "./public-thread-admission";
import type { ThreadCreationAdmission } from "./public-thread-admission";
import { toPublicThreadSessionSummary } from "./public-thread-api-presenter";
import { createPublicApiThreadMetadata } from "./public-thread-metadata";
import {
  toCreateEmptyThreadSessionSummary,
  toCreateThreadResponse,
  toCreateThreadSessionSummary,
} from "./public-thread-presenter";
import {
  cleanupFailedThreadCreation,
  findPublicThreadSnapshotByIdempotencyKey,
  setSessionTitleFromThreadPrompt,
} from "./public-thread-store";
import type { CreatePublicThreadRequest } from "./public-thread.types";

async function claimThreadFiles(input: {
  bindings: ApiBindings;
  fileIds: FileId[];
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}): Promise<void> {
  if (input.fileIds.length === 0) {
    return;
  }

  await fileStore.claimToSession(input.bindings, input.viewer, input.sessionId, input.fileIds);
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

export async function createPublicThread(
  request: CreatePublicThreadRequest,
): Promise<PublicThreadApiCreateThreadResponse> {
  const admission = await admitPublicThreadCreator(request.bindings.DB, request.caller, {
    agentId: request.agentId,
  });
  let createdSessionId: SessionId | null = null;
  const metadata = createPublicApiThreadMetadata({
    admission,
    clientExternalRef: request.input.clientExternalRef ?? null,
    idempotencyKey: request.idempotencyKey,
  });

  try {
    const session = await createAgentSession({
      bindings: request.bindings,
      executionContext: request.executionContext,
      input: {
        agentId: request.agentId,
        appId: admission.appId,
        type: "ui",
      },
      options: {
        accessViewer: admission.accessViewer,
        attributedUserId: admission.attributedUserId,
        metadata: { public_api: metadata },
      },
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

    await claimThreadFiles({
      bindings: request.bindings,
      fileIds: request.input.fileIds,
      sessionId,
      viewer: admission.fileViewer,
    });

    if (request.input.inputText === undefined) {
      return toCreateThreadResponse({
        attributedUserId: admission.attributedUserId,
        metadata,
        run: null,
        session: toCreateEmptyThreadSessionSummary(session),
      });
    }

    const queuedRun = await queueSessionRun({
      bindings: request.bindings,
      executionContext: request.executionContext ?? null,
      input: {
        accessViewer: admission.accessViewer,
        attachmentIds: request.input.fileIds,
        clientRequestId: null,
        prompt: request.input.inputText,
        session: {
          agent_id: session.agentId,
          deployment_version_id: session.deploymentVersionId,
          deployment_version_number: session.deploymentVersionNumber,
          id: sessionId,
          model: session.model,
          app_id: session.appId,
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
      prompt: request.input.inputText,
      sessionId,
    });

    const updatedSession = toCreateThreadSessionSummary({
      run,
      session,
      sessionState: runSessionState,
      titleUpdate,
    });

    return toCreateThreadResponse({
      attributedUserId: admission.attributedUserId,
      metadata,
      run,
      session: updatedSession,
    });
  } catch (error) {
    if (createdSessionId !== null) {
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
): Promise<PublicThreadApiCreateThreadResponse | null> {
  if (request.idempotencyKey === null) {
    return null;
  }

  const admission = await admitPublicThreadCreator(request.bindings.DB, request.caller, {
    agentId: request.agentId,
  });
  const snapshot = await findPublicThreadSnapshotByIdempotencyKey(request.bindings.DB, {
    agentId: request.agentId,
    idempotencyKey: request.idempotencyKey,
    tokenId: admission.tokenId,
  });

  if (!snapshot) {
    return null;
  }

  return toCreateThreadResponse({
    attributedUserId: snapshot.row.attributed_user_id,
    metadata: snapshot.metadata,
    run: snapshot.session.lastRun,
    session: toPublicThreadSessionSummary(snapshot.session),
  });
}
