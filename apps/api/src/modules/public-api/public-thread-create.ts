import type { PublicThreadApiCreateThreadResponse } from "@mosoo/contracts/public-api";
import type { FileId, AppId, SessionId } from "@mosoo/id";

import { createErrorLogContext, logError } from "../../platform/cloudflare/logger";
import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import {
  claimAppDraftFilesToSession,
  ensureAppDraftFilesClaimable,
} from "../files/application/draft-file-claim.service";
import { createAgentSession, queueSessionRun } from "../runtime/application/session-run.service";
import { admitPublicThreadCreator } from "./public-thread-admission";
import type { ThreadCreationAdmission } from "./public-thread-admission";
import { createPublicApiThreadMetadata } from "./public-thread-metadata";
import {
  toCreateEmptyThreadSessionSummary,
  toCreateThreadResponse,
  toCreateThreadSessionSummary,
} from "./public-thread-presenter";
import {
  cleanupFailedThreadCreation,
  setSessionTitleFromThreadPrompt,
} from "./public-thread-store";
import type { CreatePublicThreadRequest } from "./public-thread.types";

async function claimThreadFiles(input: {
  bindings: ApiBindings;
  fileIds: FileId[];
  appId: AppId;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}): Promise<void> {
  if (input.fileIds.length === 0) {
    return;
  }

  await claimAppDraftFilesToSession(input.bindings, input.viewer, {
    attachmentIds: input.fileIds,
    appId: input.appId,
    sessionId: input.sessionId,
  });
}

async function ensureThreadFilesClaimable(input: {
  admission: ThreadCreationAdmission;
  bindings: ApiBindings;
  fileIds: FileId[];
}): Promise<void> {
  if (input.fileIds.length === 0) {
    return;
  }

  await ensureAppDraftFilesClaimable(input.bindings, input.admission.fileViewer, {
    attachmentIds: input.fileIds,
    appId: input.admission.appId,
  });
}

export async function createPublicThread(
  request: CreatePublicThreadRequest,
): Promise<PublicThreadApiCreateThreadResponse> {
  const admission = await admitPublicThreadCreator(request.bindings.DB, request.caller, {
    agentId: request.agentId,
  });
  await ensureThreadFilesClaimable({
    admission,
    bindings: request.bindings,
    fileIds: request.input.fileIds,
  });
  let createdSessionId: SessionId | null = null;
  const metadata = createPublicApiThreadMetadata({
    admission,
    clientExternalRef: request.input.clientExternalRef ?? null,
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

    await claimThreadFiles({
      bindings: request.bindings,
      fileIds: request.input.fileIds,
      appId: admission.appId,
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
          organization_id: session.organizationId,
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
