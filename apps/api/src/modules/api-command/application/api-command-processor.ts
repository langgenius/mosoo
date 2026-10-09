import { apiCommandsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { buildEnvironmentPackageArtifact } from "../../environments/application/environment-package-artifact-build.service";
import { dispatchQueuedSessionRun } from "../../runtime/application/session-runs/dispatch-queued-run.service";
import {
  claimApiCommand,
  completeApiCommand,
  markApiCommandDeadLettered,
  markApiCommandFailed,
  releaseApiCommandForRetry,
} from "./api-command-ledger";
import type { ApiCommandClaim } from "./api-command-ledger";
import type { ApiCommandMessage } from "./api-command-message";
import { ApiCommandPermanentError } from "./api-command-payload";
import type {
  EnvironmentPackageArtifactBuildCommandPayload,
  SessionRunDispatchCommandPayload,
} from "./api-command-payload";

const API_COMMAND_RETRY_DELAY_SECONDS = 30;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "API command processing failed.";
}

function getErrorCode(error: unknown): string {
  if (error instanceof ApiCommandPermanentError) {
    return error.code;
  }

  if (error instanceof Error && error.name.trim().length > 0) {
    return error.name;
  }

  return "api_command_failed";
}

async function processSessionRunDispatchCommand(
  bindings: ApiBindings,
  payload: SessionRunDispatchCommandPayload,
): Promise<void> {
  await dispatchQueuedSessionRun({
    bindings,
    input: {
      attachmentIds: payload.attachmentIds,
      dispatchSource: "queue",
      prompt: payload.prompt,
      queuedAtMs: payload.queuedAtMs,
      session: payload.session,
      sessionRunId: payload.sessionRunId,
      traceId: payload.traceId,
      ...(payload.accessViewer ? { accessViewer: payload.accessViewer } : {}),
    },
    requestUrl: payload.requestUrl,
    viewer: payload.viewer,
  });
}

async function processClaimedApiCommand(
  bindings: ApiBindings,
  claim: ApiCommandClaim,
): Promise<void> {
  switch (claim.kind) {
    case "environment_package_artifact_build": {
      await buildEnvironmentPackageArtifact(
        bindings,
        JSON.parse(claim.payloadJson) as EnvironmentPackageArtifactBuildCommandPayload,
      );
      return;
    }
    case "session_run_dispatch": {
      await processSessionRunDispatchCommand(
        bindings,
        JSON.parse(claim.payloadJson) as SessionRunDispatchCommandPayload,
      );
      return;
    }
  }
}

export async function processApiCommandMessage(
  bindings: ApiBindings,
  message: Message<ApiCommandMessage>,
  nowMs: () => number = currentTimestampMs,
): Promise<void> {
  const { commandId } = message.body;
  const ownerId = message.id;
  const claim = await claimApiCommand({
    commandId,
    database: bindings.DB,
    nowMs: nowMs(),
    ownerId,
  });

  if (!claim) {
    message.ack();
    return;
  }

  try {
    await processClaimedApiCommand(bindings, claim);
    await completeApiCommand({
      commandId,
      database: bindings.DB,
      nowMs: nowMs(),
      ownerId,
    });
    message.ack();
  } catch (error) {
    const errorCode = getErrorCode(error);
    const errorMessage = getErrorMessage(error);

    logError("api-command.failed", {
      ...createErrorLogContext(error),
      attemptCount: claim.attemptCount,
      commandId,
      errorCode,
      kind: claim.kind,
    });

    if (error instanceof ApiCommandPermanentError) {
      await markApiCommandFailed({
        commandId,
        database: bindings.DB,
        errorCode,
        errorMessage,
        nowMs: nowMs(),
        ownerId,
      });
      message.ack();
      return;
    }

    await releaseApiCommandForRetry({
      commandId,
      database: bindings.DB,
      errorCode,
      errorMessage,
      nowMs: nowMs(),
      ownerId,
    });
    message.retry({ delaySeconds: API_COMMAND_RETRY_DELAY_SECONDS });
  }
}

export async function processApiCommandDeadLetterMessage(
  bindings: ApiBindings,
  message: Message<ApiCommandMessage>,
  nowMs: () => number = currentTimestampMs,
): Promise<void> {
  const { commandId } = message.body;
  const command = await getAppDatabase(bindings.DB)
    .select({
      lastErrorCode: apiCommandsTable.lastErrorCode,
      lastErrorMessage: apiCommandsTable.lastErrorMessage,
    })
    .from(apiCommandsTable)
    .where(eq(apiCommandsTable.id, commandId))
    .get();

  await markApiCommandDeadLettered({
    commandId,
    database: bindings.DB,
    errorCode: command?.lastErrorCode ?? "queue_dead_lettered",
    errorMessage:
      command?.lastErrorMessage ?? "API command reached the queue dead-letter consumer.",
    nowMs: nowMs(),
  });
  message.ack();
}
