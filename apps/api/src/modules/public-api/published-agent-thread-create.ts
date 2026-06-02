import type { PublishedAgentCreateThreadResponse } from "@mosoo/contracts/public-api";
import type { FileId, OrganizationId, SessionId } from "@mosoo/id";

import { createErrorLogContext, logError } from "../../platform/cloudflare/logger";
import type { ApiBindings } from "../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../auth/application/viewer-auth.service";
import {
  claimOrganizationDraftFilesToSession,
  ensureOrganizationDraftFilesClaimable,
} from "../files/application/draft-file-claim.service";
import { createAgentSession, queueSessionRun } from "../runtime/application/session-run.service";
import { publicInvalidRequest } from "./published-agent-api-errors";
import { admitPublishedThreadCreator } from "./published-agent-thread-admission";
import type { ThreadCreationAdmission } from "./published-agent-thread-admission";
import { createPublicApiThreadMetadata } from "./published-agent-thread-metadata";
import {
  toCreateThreadResponse,
  toCreateThreadSessionSummary,
} from "./published-agent-thread-presenter";
import {
  cleanupFailedThreadCreation,
  setSessionTitleFromThreadPrompt,
} from "./published-agent-thread-store";
import type { CreatePublishedAgentThreadRequest } from "./published-agent-thread.types";

async function claimThreadFiles(input: {
  bindings: ApiBindings;
  fileIds: FileId[];
  organizationId: OrganizationId;
  sessionId: SessionId;
  viewer: AuthenticatedViewer;
}): Promise<void> {
  if (input.fileIds.length === 0) {
    return;
  }

  await claimOrganizationDraftFilesToSession(input.bindings, input.viewer, {
    attachmentIds: input.fileIds,
    organizationId: input.organizationId,
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

  if (input.admission.createdByKind === "service_token") {
    throw publicInvalidRequest(
      "Organization Service token callers cannot attach files in the MVP Thread API.",
    );
  }

  await ensureOrganizationDraftFilesClaimable(input.bindings, input.admission.fileViewer, {
    attachmentIds: input.fileIds,
    organizationId: input.admission.organizationId,
  });
}

export async function createPublishedAgentThread(
  request: CreatePublishedAgentThreadRequest,
): Promise<PublishedAgentCreateThreadResponse> {
  const admission = await admitPublishedThreadCreator(request.bindings.DB, request.caller, {
    agentId: request.agentId,
    attributedUserId: request.input.attributedUserId,
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
        type: admission.attributedUserId === null ? "api_channel" : "ui",
      },
      options: {
        accessViewer: admission.accessViewer,
        attributedUserId: admission.attributedUserId,
        auditActor: {
          display:
            admission.createdByKind === "service_token"
              ? `Service Token: ${admission.tokenLabel}`
              : `API Key: ${admission.tokenLabel}`,
          id: admission.tokenId,
          metadata: {
            attributedUserId: admission.attributedUserId ?? "",
            clientExternalRef: metadata.client_external_ref ?? "",
            executionOwnerId: admission.executionOwnerId,
            publicApiCredentialId: admission.tokenId,
            publicApiCredentialLabel: admission.tokenLabel,
            source: "public_api",
          },
          type: "api_key",
        },
        metadata: { public_api: metadata },
      },
      viewer: admission.creatorViewer,
    });
    const sessionId = session.id;
    createdSessionId = sessionId;

    await claimThreadFiles({
      bindings: request.bindings,
      fileIds: request.input.fileIds,
      organizationId: admission.organizationId,
      sessionId,
      viewer: admission.fileViewer,
    });

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
