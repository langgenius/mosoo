import { createErrorLogContext, logError, logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { currentTimestampMs } from "../../../time";
import {
  parseCostLedgerReconciliationActivationMode,
  reconcileCostLedgerPage,
} from "../../cost/application/cost-ledger-reconciliation.service";
import { runUsageDailyRollup } from "../../cost/application/cost-rollup.service";
import { buildEnvironmentPackageArtifact } from "../../environments/application/environment-package-artifact-build.service";
import { dispatchQueuedSessionRun } from "../../runtime/application/session-runs/dispatch-queued-run.service";
import { createLeaseOwnershipRenewal } from "../../runtime/infrastructure/runtime-subject-lifecycle/lease-ownership-renewal";
import { runSandboxMaintenance } from "../../runtime/infrastructure/runtime-subject-lifecycle/runtime-subject-maintenance.service";
import { reconcileSandboxBackupPage } from "../../runtime/infrastructure/sandbox-backup-reconciliation.service";
import {
  enqueueCostLedgerReconciliationCommand,
  enqueueSandboxBackupReconciliationCommand,
} from "./api-command-enqueue";
import {
  API_COMMAND_LEASE_MS,
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
  SandboxBackupReconciliationCommandPayload,
  ScheduledMaintenanceCommandPayload,
  SessionRunDispatchCommandPayload,
} from "./api-command-payload";

const API_COMMAND_RETRY_DELAY_SECONDS = 30;

export type ApiCommandDeliveryDisposition =
  | { readonly kind: "finished" }
  | { readonly delaySeconds: number; readonly kind: "retry" };

const FINISHED_DISPOSITION = { kind: "finished" } as const;

function retryDisposition(delaySeconds = API_COMMAND_RETRY_DELAY_SECONDS) {
  return { delaySeconds, kind: "retry" } as const;
}

function createClaimOwnerId(): string {
  return crypto.randomUUID();
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

function shouldStartSandboxBackupReconciliation(now: Date): boolean {
  return now.getUTCHours() === 3 && now.getUTCMinutes() === 0;
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

  if (shouldStartSandboxBackupReconciliation(scheduledAt)) {
    tasks.push(
      enqueueSandboxBackupReconciliationCommand(bindings, {
        cursor: null,
        databasePage: 0,
        scheduledTime: payload.scheduledTime,
      }),
    );
  }

  await Promise.all(tasks);
}

async function processSandboxBackupReconciliationCommand(
  bindings: ApiBindings,
  payload: SandboxBackupReconciliationCommandPayload,
  processedAtMs: number,
): Promise<void> {
  const result = await reconcileSandboxBackupPage(bindings, {
    cursor: payload.cursor,
  });
  logInfo("runtime.sandbox_backup.reconciliation_page_completed", {
    ...result,
    processedAtMs,
    scheduledTime: payload.scheduledTime,
  });
  if (!result.hasMore) {
    return;
  }
  if (payload.databasePage === Number.MAX_SAFE_INTEGER) {
    throw new Error("Sandbox backup reconciliation exhausted its database page identity.");
  }
  await enqueueSandboxBackupReconciliationCommand(bindings, {
    cursor: result.nextCursor,
    databasePage: payload.databasePage + 1,
    scheduledTime: payload.scheduledTime,
  });
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
  requireOwnership: () => Promise<void>,
): Promise<void> {
  const payload = parseApiCommandPayload(claim.kind, claim.payloadJson);
  const authority = {
    attemptCount: claim.attemptCount,
    claimOwner: claim.claimOwner,
    commandId: claim.commandId,
    deliveryGeneration: claim.deliveryGeneration,
    requireOwnership,
  };

  await requireOwnership();

  switch (claim.kind) {
    case "cost_ledger_reconciliation": {
      await processCostLedgerReconciliationCommand(
        bindings,
        payload as CostLedgerReconciliationCommandPayload,
        processedAtMs,
      );
      break;
    }
    case "environment_package_artifact_build": {
      await buildEnvironmentPackageArtifact(
        bindings,
        payload as EnvironmentPackageArtifactBuildCommandPayload,
        authority,
      );
      break;
    }
    case "sandbox_backup_reconciliation": {
      await processSandboxBackupReconciliationCommand(
        bindings,
        payload as SandboxBackupReconciliationCommandPayload,
        processedAtMs,
      );
      break;
    }
    case "scheduled_maintenance": {
      await processScheduledMaintenanceCommand(
        bindings,
        payload as ScheduledMaintenanceCommandPayload,
      );
      break;
    }
    case "session_run_dispatch": {
      await processSessionRunDispatchCommand(bindings, payload as SessionRunDispatchCommandPayload);
      break;
    }
  }

  await requireOwnership();
}

async function processClaimedApiCommandWithLeaseRenewal(
  bindings: ApiBindings,
  claim: ApiCommandClaim,
  nowMs: () => number,
): Promise<void> {
  let stopped = false;
  let lossEvent: "api-command.claim_lost" | "api-command.claim_renew_failed" | null = null;
  let lossLogged = false;
  let pendingHeartbeat = Promise.resolve();
  const requireOwnership = createLeaseOwnershipRenewal(async () => {
    try {
      const renewed = await renewApiCommandClaim({
        claim,
        database: bindings.DB,
        nowMs: nowMs(),
      });
      if (!renewed) {
        lossEvent ??= "api-command.claim_lost";
      }
      return renewed;
    } catch (error) {
      lossEvent ??= "api-command.claim_renew_failed";
      throw error;
    }
  }, "API command lease ownership was lost.");
  const logOwnershipLoss = (error: unknown): void => {
    if (lossLogged || lossEvent === null) {
      return;
    }
    lossLogged = true;
    logError(lossEvent, {
      ...createErrorLogContext(error),
      attemptCount: claim.attemptCount,
      commandId: claim.commandId,
      deliveryGeneration: claim.deliveryGeneration,
      kind: claim.kind,
    });
  };
  const timer = setInterval(() => {
    if (stopped) {
      return;
    }

    pendingHeartbeat = requireOwnership().catch(logOwnershipLoss);
  }, API_COMMAND_LEASE_RENEWAL_INTERVAL_MS);

  try {
    await requireOwnership();
    await processClaimedApiCommand(bindings, claim, nowMs(), requireOwnership);
    await requireOwnership();
  } catch (error) {
    logOwnershipLoss(error);
    throw error;
  } finally {
    stopped = true;
    clearInterval(timer);
    await pendingHeartbeat;
  }
}

function busyRetryDelaySeconds(claimExpiresAt: number | null, nowMs: number): number {
  if (claimExpiresAt === null) {
    return API_COMMAND_RETRY_DELAY_SECONDS;
  }
  return Math.min(
    API_COMMAND_LEASE_MS / 1_000,
    Math.max(1, Math.ceil((claimExpiresAt - nowMs) / 1_000)),
  );
}

function retryMessage(message: Message<ApiCommandMessage>, delaySeconds: number): void {
  message.retry({ delaySeconds });
}

async function handleClaimedCommandFailure(
  bindings: ApiBindings,
  claim: ApiCommandClaim,
  error: unknown,
  nowMs: () => number,
): Promise<ApiCommandDeliveryDisposition> {
  const errorCode = getErrorCode(error);
  const errorMessage = getErrorMessage(error);

  logError("api-command.failed", {
    ...createErrorLogContext(error),
    attemptCount: claim.attemptCount,
    commandId: claim.commandId,
    deliveryGeneration: claim.deliveryGeneration,
    errorCode,
    kind: claim.kind,
  });

  try {
    if (error instanceof ApiCommandPayloadError) {
      const terminalized = await markApiCommandFailed({
        claim,
        database: bindings.DB,
        errorCode,
        errorMessage,
        nowMs: nowMs(),
      });
      return terminalized ? FINISHED_DISPOSITION : retryDisposition();
    }

    await releaseApiCommandForRetry({
      claim,
      database: bindings.DB,
      errorCode,
      errorMessage,
      nowMs: nowMs(),
    });
  } catch (persistenceError) {
    logError("api-command.failure_persist_failed", {
      ...createErrorLogContext(persistenceError),
      commandId: claim.commandId,
      deliveryGeneration: claim.deliveryGeneration,
    });
  }

  return retryDisposition();
}

export async function processApiCommandDelivery(
  bindings: ApiBindings,
  body: unknown,
  nowMs: () => number = currentTimestampMs,
): Promise<ApiCommandDeliveryDisposition> {
  let queueMessage: ApiCommandMessage;

  try {
    queueMessage = parseApiCommandMessage(body);
  } catch (error) {
    logError("api-command.message_invalid", {
      ...createErrorLogContext(error),
      errorCode: getErrorCode(error),
    });
    return FINISHED_DISPOSITION;
  }

  const claimStartedAtMs = nowMs();
  let claimResult: Awaited<ReturnType<typeof claimApiCommand>>;
  try {
    claimResult = await claimApiCommand({
      claimOwner: createClaimOwnerId(),
      commandId: queueMessage.commandId,
      database: bindings.DB,
      deliveryGeneration: queueMessage.deliveryGeneration,
      nowMs: claimStartedAtMs,
    });
  } catch (error) {
    logError("api-command.claim_failed", {
      ...createErrorLogContext(error),
      commandId: queueMessage.commandId,
      deliveryGeneration: queueMessage.deliveryGeneration,
    });
    return retryDisposition();
  }

  if (claimResult.kind === "busy") {
    return retryDisposition(busyRetryDelaySeconds(claimResult.claimExpiresAt, claimStartedAtMs));
  }
  if (claimResult.kind !== "claimed") {
    return FINISHED_DISPOSITION;
  }

  const claim = claimResult.claim;
  try {
    await processClaimedApiCommandWithLeaseRenewal(bindings, claim, nowMs);
  } catch (error) {
    return handleClaimedCommandFailure(bindings, claim, error, nowMs);
  }

  try {
    const finalized = await completeApiCommand({ claim, database: bindings.DB, nowMs: nowMs() });
    return finalized ? FINISHED_DISPOSITION : retryDisposition();
  } catch (error) {
    logError("api-command.completion_failed", {
      ...createErrorLogContext(error),
      commandId: claim.commandId,
      deliveryGeneration: claim.deliveryGeneration,
    });
    return retryDisposition();
  }
}

export async function processApiCommandMessage(
  bindings: ApiBindings,
  message: Message<ApiCommandMessage>,
  nowMs: () => number = currentTimestampMs,
): Promise<void> {
  let queueMessage: ApiCommandMessage;
  try {
    queueMessage = parseApiCommandMessage(message.body);
  } catch (error) {
    logError("api-command.message_invalid", {
      ...createErrorLogContext(error),
      errorCode: getErrorCode(error),
    });
    message.ack();
    return;
  }
  const disposition = await processApiCommandDelivery(bindings, queueMessage, nowMs);
  if (disposition.kind === "finished") {
    message.ack();
    return;
  }
  retryMessage(message, disposition.delaySeconds);
}

export async function processApiCommandDeadLetterMessage(
  bindings: ApiBindings,
  message: Message<ApiCommandMessage>,
  nowMs: () => number = currentTimestampMs,
): Promise<void> {
  let queueMessage: ApiCommandMessage;
  try {
    queueMessage = parseApiCommandMessage(message.body);
  } catch (error) {
    logError("api-command.dead_letter_invalid", {
      ...createErrorLogContext(error),
      errorCode: getErrorCode(error),
    });
    message.ack();
    return;
  }

  const claimStartedAtMs = nowMs();
  try {
    const claimResult = await claimApiCommand({
      claimOwner: createClaimOwnerId(),
      commandId: queueMessage.commandId,
      database: bindings.DB,
      deliveryGeneration: queueMessage.deliveryGeneration,
      nowMs: claimStartedAtMs,
    });
    if (claimResult.kind === "busy") {
      retryMessage(message, busyRetryDelaySeconds(claimResult.claimExpiresAt, claimStartedAtMs));
      return;
    }
    if (claimResult.kind !== "claimed") {
      message.ack();
      return;
    }

    const claim = claimResult.claim;
    const preserveArtifactFailure = claim.kind === "environment_package_artifact_build";
    const errorCode =
      preserveArtifactFailure && claimResult.claim.lastErrorCode
        ? claimResult.claim.lastErrorCode
        : "queue_dead_lettered";
    const errorMessage =
      preserveArtifactFailure && claimResult.claim.lastErrorMessage
        ? claimResult.claim.lastErrorMessage
        : "API command reached the queue dead-letter consumer.";
    const deadLettered = await markApiCommandDeadLettered({
      claim,
      database: bindings.DB,
      errorCode,
      errorMessage,
      nowMs: nowMs(),
    });

    if (deadLettered) {
      message.ack();
    } else {
      retryMessage(message, API_COMMAND_RETRY_DELAY_SECONDS);
    }
  } catch (error) {
    logError("api-command.dead_letter_failed", {
      ...createErrorLogContext(error),
      commandId: queueMessage.commandId,
      deliveryGeneration: queueMessage.deliveryGeneration,
    });
    retryMessage(message, API_COMMAND_RETRY_DELAY_SECONDS);
  }
}
