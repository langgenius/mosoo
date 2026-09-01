import { apiCommandsTable } from "@mosoo/db";
import type { ApiCommandId } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { createErrorLogContext, logError, logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import {
  parseCostLedgerReconciliationActivationMode,
  reconcileCostLedgerPage,
} from "../../cost/application/cost-ledger-reconciliation.service";
import { runUsageDailyRollup } from "../../cost/application/cost-rollup.service";
import { buildEnvironmentPackageArtifact } from "../../environments/application/environment-package-artifact-build.service";
import { dispatchQueuedSessionRun } from "../../runtime/application/session-runs/dispatch-queued-run.service";
import { runSandboxMaintenance } from "../../runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-maintenance.service";
import { enqueueCostLedgerReconciliationCommand } from "./api-command-enqueue";
import {
  API_COMMAND_LEASE_RENEWAL_INTERVAL_MS,
  claimApiCommand,
  completeApiCommand,
  markApiCommandDeadLettered,
  markApiCommandFailed,
  releaseApiCommandForRetry,
  renewApiCommandClaim,
} from "./api-command-ledger";
import type { ApiCommandClaim } from "./api-command-ledger";
import { parseApiCommandMessage } from "./api-command-message";
import type { ApiCommandMessage } from "./api-command-message";
import { ApiCommandPayloadError, parseApiCommandPayload } from "./api-command-payload";
import type {
  CostLedgerReconciliationCommandPayload,
  EnvironmentPackageArtifactBuildCommandPayload,
  ScheduledMaintenanceCommandPayload,
  SessionRunDispatchCommandPayload,
} from "./api-command-payload";

const API_COMMAND_RETRY_DELAY_SECONDS = 30;

function createClaimOwnerId(message: Message<ApiCommandMessage>): string {
  const normalized = message.id.replaceAll(":", "_").trim();
  return normalized || "api-command-worker";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "API command processing failed.";
}

function getErrorCode(error: unknown): string {
  if (error instanceof ApiCommandPayloadError) {
    return "invalid_payload";
  }

  if (error instanceof Error && error.name.trim().length > 0) {
    return error.name;
  }

  return "api_command_failed";
}

function shouldRunUsageDailyRollup(now: Date): boolean {
  return now.getUTCHours() === 2 && now.getUTCMinutes() === 0;
}

function shouldStartCostLedgerReconciliation(now: Date): boolean {
  return now.getUTCHours() === 1 && now.getUTCMinutes() === 0;
}

async function processScheduledMaintenanceCommand(
  bindings: ApiBindings,
  payload: ScheduledMaintenanceCommandPayload,
): Promise<void> {
  const scheduledAt = new Date(payload.scheduledTime);
  const tasks: Promise<unknown>[] = [runSandboxMaintenance(bindings)];

  if (shouldRunUsageDailyRollup(scheduledAt)) {
    tasks.push(runUsageDailyRollup(bindings, scheduledAt));
  }

  if (shouldStartCostLedgerReconciliation(scheduledAt)) {
    const mode = parseCostLedgerReconciliationActivationMode(
      bindings.MOSOO_COST_LEDGER_RECONCILIATION_MODE,
    );

    if (mode !== null) {
      tasks.push(
        enqueueCostLedgerReconciliationCommand(bindings, {
          cursor: null,
          mode,
          scheduledTime: payload.scheduledTime,
        }),
      );
    }
  }

  await Promise.all(tasks);
}

async function processCostLedgerReconciliationCommand(
  bindings: ApiBindings,
  payload: CostLedgerReconciliationCommandPayload,
  processedAtMs: number,
): Promise<void> {
  const result = await reconcileCostLedgerPage(bindings.DB, {
    cursor: payload.cursor,
    mode: payload.mode,
    now: new Date(processedAtMs),
  });

  logInfo("cost.ledger_reconciliation.page_completed", {
    ...result,
    processedAtMs,
    scheduledTime: payload.scheduledTime,
  });

  if (!result.hasMore) {
    return;
  }

  if (result.nextCursor === null) {
    throw new Error("Cost ledger reconciliation returned no cursor for an incomplete page.");
  }

  await enqueueCostLedgerReconciliationCommand(bindings, {
    cursor: result.nextCursor,
    mode: payload.mode,
    scheduledTime: payload.scheduledTime,
  });
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
  processedAtMs: number,
): Promise<void> {
  const payload = parseApiCommandPayload(claim.kind, claim.payloadJson);

  switch (claim.kind) {
    case "cost_ledger_reconciliation": {
      await processCostLedgerReconciliationCommand(
        bindings,
        payload as CostLedgerReconciliationCommandPayload,
        processedAtMs,
      );
      return;
    }
    case "environment_package_artifact_build": {
      await buildEnvironmentPackageArtifact(
        bindings,
        payload as EnvironmentPackageArtifactBuildCommandPayload,
      );
      return;
    }
    case "scheduled_maintenance": {
      await processScheduledMaintenanceCommand(
        bindings,
        payload as ScheduledMaintenanceCommandPayload,
      );
      return;
    }
    case "session_run_dispatch": {
      await processSessionRunDispatchCommand(bindings, payload as SessionRunDispatchCommandPayload);
      return;
    }
  }
}

async function processClaimedApiCommandWithLeaseRenewal(
  bindings: ApiBindings,
  claim: ApiCommandClaim,
  ownerId: string,
  processedAtMs: number,
): Promise<void> {
  let stopped = false;
  let renewal = Promise.resolve();
  const timer = setInterval(() => {
    if (stopped) {
      return;
    }

    renewal = renewal
      .then(() =>
        renewApiCommandClaim({
          commandId: claim.commandId,
          database: bindings.DB,
          ownerId,
        }),
      )
      .then((renewed) => {
        if (renewed) {
          return;
        }

        stopped = true;
        logError("api-command.claim_lost", {
          commandId: claim.commandId,
          kind: claim.kind,
        });
      })
      .catch((error: unknown) => {
        logError("api-command.claim_renew_failed", {
          ...createErrorLogContext(error),
          commandId: claim.commandId,
          kind: claim.kind,
        });
      });
  }, API_COMMAND_LEASE_RENEWAL_INTERVAL_MS);

  try {
    await processClaimedApiCommand(bindings, claim, processedAtMs);
    stopped = true;
    await renewal;
  } finally {
    stopped = true;
    clearInterval(timer);
  }
}

export async function processApiCommandMessage(
  bindings: ApiBindings,
  message: Message<ApiCommandMessage>,
  nowMs: () => number = currentTimestampMs,
): Promise<void> {
  let commandId: ApiCommandId;

  try {
    commandId = parseApiCommandMessage(message.body).commandId;
  } catch (error) {
    logError("api-command.message_invalid", {
      ...createErrorLogContext(error),
      errorCode: getErrorCode(error),
    });
    message.ack();
    return;
  }

  const ownerId = createClaimOwnerId(message);
  const startMs = nowMs();
  const claim = await claimApiCommand({
    commandId,
    database: bindings.DB,
    nowMs: startMs,
    ownerId,
  });

  if (!claim) {
    message.ack();
    return;
  }

  try {
    await processClaimedApiCommandWithLeaseRenewal(bindings, claim, ownerId, nowMs());
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

    if (error instanceof ApiCommandPayloadError) {
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
  try {
    const { commandId } = parseApiCommandMessage(message.body);
    const deadLetteredAtMs = nowMs();
    const command =
      (await getAppDatabase(bindings.DB)
        .select({
          kind: apiCommandsTable.kind,
          lastErrorCode: apiCommandsTable.lastErrorCode,
          lastErrorMessage: apiCommandsTable.lastErrorMessage,
        })
        .from(apiCommandsTable)
        .where(eq(apiCommandsTable.id, commandId))
        .limit(1)
        .get()) ?? null;

    const preserveArtifactFailure = command?.kind === "environment_package_artifact_build";

    await markApiCommandDeadLettered({
      commandId,
      database: bindings.DB,
      errorCode:
        preserveArtifactFailure && command.lastErrorCode
          ? command.lastErrorCode
          : "queue_dead_lettered",
      errorMessage:
        preserveArtifactFailure && command.lastErrorMessage
          ? command.lastErrorMessage
          : "API command reached the queue dead-letter consumer.",
      nowMs: deadLetteredAtMs,
    });
  } catch (error) {
    logError("api-command.dead_letter_invalid", {
      ...createErrorLogContext(error),
      errorCode: getErrorCode(error),
    });
  }

  message.ack();
}
