import { sessionsTable } from "@mosoo/db";
import type { SessionId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { createErrorLogContext, logError, logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { resolveAgentChannelBindingContextById } from "./channel-binding-context";
import {
  getDeliveryErrorCode,
  isCredentialScopedDeliveryError,
  markBindingErrorIfCredentialScoped,
} from "./channel-final-delivery-errors";
import {
  claimJobForDelivery,
  markJobDelivered,
  markJobFailed,
  parseActiveChannelFinalDeliveryClaim,
  readJobLedger,
  recordJobAttempt,
  recordJobWait,
} from "./channel-final-delivery-jobs";
import { parseChannelFinalDeliveryMessage } from "./channel-final-delivery-message";
import type { ChannelFinalDeliveryMessage } from "./channel-final-delivery-message";
import {
  ChannelFinalDeliveryPayloadError,
  parseChannelFinalDeliveryPayloadJson,
} from "./channel-final-delivery-payload";
import { sendProviderFinalReply } from "./channel-final-delivery-reply";
import { createChannelSessionClient } from "./channel-session-command-client";

const CHANNEL_FINAL_DELIVERY_RETRY_DELAY_SECONDS = 60;
const CHANNEL_FINAL_DELIVERY_WAIT_DELAY_SECONDS = 30;
const CHANNEL_FINAL_DELIVERY_MAX_DELIVERY_ATTEMPTS = 8;
const CHANNEL_FINAL_DELIVERY_PROVIDER_REQUEST_TIMEOUT_MS = 30 * 1000;

export type { ChannelFinalDeliveryMessage } from "./channel-final-delivery-message";
export {
  createChannelFinalDeliveryScheduler,
  enqueueChannelFinalDeliveryJob,
  redriveFailedChannelFinalDeliveryEnqueues,
} from "./channel-final-delivery-jobs";
export type {
  ChannelFinalDeliveryScheduler,
  EnqueueChannelFinalDeliveryJobInput,
} from "./channel-final-delivery-jobs";

export interface ProcessChannelFinalDeliveryMessageOptions {
  providerRequestTimeoutMs?: number;
}

function createClaimOwnerId(message: Message<ChannelFinalDeliveryMessage>): string {
  const normalized = message.id.replaceAll(":", "_").trim();
  return normalized || "channel-final-delivery-worker";
}

async function ensureSessionCanReceiveFinalDelivery(input: {
  attemptCount: number;
  bindings: ApiBindings;
  jobId: ChannelFinalDeliveryMessage["jobId"];
  nowMs: number;
  sessionId: SessionId;
}): Promise<boolean> {
  const session =
    (await getAppDatabase(input.bindings.DB)
      .select({ status: sessionsTable.status })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, input.sessionId))
      .limit(1)
      .get()) ?? null;

  if (session !== null && session.status !== "TERMINATED") {
    return true;
  }

  await markJobFailed({
    attemptCount: input.attemptCount,
    database: input.bindings.DB,
    errorCode: "session_not_deliverable",
    jobId: input.jobId,
    nowMs: input.nowMs,
  });
  return false;
}

async function requeueDelayedWakeup(input: {
  bindings: ApiBindings;
  delaySeconds: number;
  jobId: ChannelFinalDeliveryMessage["jobId"];
  message: Message<ChannelFinalDeliveryMessage>;
}): Promise<void> {
  try {
    await input.bindings.CHANNEL_FINAL_DELIVERY_QUEUE.send(
      { jobId: input.jobId },
      { delaySeconds: input.delaySeconds },
    );
    input.message.ack();
  } catch (error) {
    logError("channel-final-delivery.requeue_failed", {
      ...createErrorLogContext(error),
      delaySeconds: input.delaySeconds,
      jobId: input.jobId,
    });
    input.message.retry({ delaySeconds: input.delaySeconds });
  }
}

export async function processChannelFinalDeliveryMessage(
  bindings: ApiBindings,
  message: Message<ChannelFinalDeliveryMessage>,
  options: ProcessChannelFinalDeliveryMessageOptions = {},
  nowMs: () => number = currentTimestampMs,
): Promise<void> {
  let body: ChannelFinalDeliveryMessage;

  try {
    body = parseChannelFinalDeliveryMessage(message.body);
  } catch (error) {
    logError("channel-final-delivery.message_invalid", {
      ...createErrorLogContext(error),
      errorCode: getDeliveryErrorCode(error),
    });
    message.ack();
    return;
  }

  const providerRequestTimeoutMs =
    options.providerRequestTimeoutMs ?? CHANNEL_FINAL_DELIVERY_PROVIDER_REQUEST_TIMEOUT_MS;
  const startMs = nowMs();
  const ledger = await readJobLedger({ database: bindings.DB, jobId: body.jobId });
  let claim: Awaited<ReturnType<typeof claimJobForDelivery>> = null;

  if (!ledger) {
    logInfo("channel-final-delivery.ledger_missing", {
      jobId: body.jobId,
    });
    message.ack();
    return;
  }

  if (ledger.status !== "dispatched") {
    message.ack();
    return;
  }

  const activeClaim = parseActiveChannelFinalDeliveryClaim(ledger.lastErrorCode, startMs);

  if (activeClaim) {
    await requeueDelayedWakeup({
      bindings,
      delaySeconds: Math.max(1, Math.ceil((activeClaim.leaseExpiresAtMs - startMs) / 1000)),
      jobId: body.jobId,
      message,
    });
    return;
  }

  const attemptCount = ledger.attemptCount + 1;
  let binding: Awaited<ReturnType<typeof resolveAgentChannelBindingContextById>> = null;

  try {
    if (
      !(await ensureSessionCanReceiveFinalDelivery({
        attemptCount,
        bindings,
        jobId: body.jobId,
        nowMs: startMs,
        sessionId: ledger.sessionId,
      }))
    ) {
      message.ack();
      return;
    }

    const payload = parseChannelFinalDeliveryPayloadJson(ledger.provider, ledger.payloadJson);
    binding = await resolveAgentChannelBindingContextById(bindings, {
      bindingId: ledger.bindingId,
      provider: ledger.provider,
    });

    if (!binding) {
      await markJobFailed({
        attemptCount,
        database: bindings.DB,
        errorCode: "binding_not_found",
        jobId: body.jobId,
        nowMs: startMs,
      });
      message.ack();
      return;
    }

    const sessionClient = createChannelSessionClient({
      binding,
      bindings,
      executionContext: null,
      requestUrl: "queue://channel-final-delivery",
    });
    const result = await sessionClient.retrieveSessionReply(ledger.sessionId, ledger.runId);

    if (!result) {
      await recordJobWait({
        database: bindings.DB,
        jobId: body.jobId,
        nowMs: startMs,
      });
      await requeueDelayedWakeup({
        bindings,
        delaySeconds: CHANNEL_FINAL_DELIVERY_WAIT_DELAY_SECONDS,
        jobId: body.jobId,
        message,
      });
      return;
    }

    claim = await claimJobForDelivery({
      database: bindings.DB,
      expectedAttemptCount: ledger.attemptCount,
      jobId: body.jobId,
      leaseDurationMs: providerRequestTimeoutMs * 2,
      nowMs: startMs,
      ownerId: createClaimOwnerId(message),
    });

    if (!claim) {
      message.ack();
      return;
    }

    await sendProviderFinalReply({
      binding,
      bindings,
      payload,
      providerRequestTimeoutMs,
      result,
      sessionId: ledger.sessionId,
      sessionLinkBaseUrl: bindings.WEB_ORIGIN,
    });

    await markJobDelivered({
      attemptCount: claim.attemptCount,
      claimCode: claim.claimCode,
      database: bindings.DB,
      jobId: body.jobId,
      nowMs: startMs,
    });

    logInfo("channel-final-delivery.delivered", {
      attemptCount,
      bindingId: ledger.bindingId,
      durationMs: nowMs() - startMs,
      jobId: body.jobId,
      provider: ledger.provider,
      runId: ledger.runId,
      sessionId: ledger.sessionId,
    });
    message.ack();
  } catch (error) {
    const errorCode = getDeliveryErrorCode(error);
    const credentialScoped = isCredentialScopedDeliveryError(error);

    if (binding && credentialScoped) {
      try {
        await markBindingErrorIfCredentialScoped({
          error,
          sessionClient: createChannelSessionClient({
            binding,
            bindings,
            executionContext: null,
            requestUrl: "queue://channel-final-delivery",
          }),
        });
      } catch (markError) {
        logError("channel-final-delivery.binding_error_mark_failed", {
          ...createErrorLogContext(markError),
          bindingId: ledger.bindingId,
          errorCode: getDeliveryErrorCode(markError),
          originalErrorCode: errorCode,
          provider: ledger.provider,
        });
      }
    }

    logError("channel-final-delivery.failed", {
      ...createErrorLogContext(error),
      attemptCount,
      bindingId: ledger.bindingId,
      errorCode,
      jobId: body.jobId,
      provider: ledger.provider,
      runId: ledger.runId,
      sessionId: ledger.sessionId,
    });

    if (credentialScoped || error instanceof ChannelFinalDeliveryPayloadError) {
      await markJobFailed({
        attemptCount,
        database: bindings.DB,
        errorCode,
        jobId: body.jobId,
        nowMs: startMs,
      });
      message.ack();
      return;
    }

    if (attemptCount >= CHANNEL_FINAL_DELIVERY_MAX_DELIVERY_ATTEMPTS) {
      await markJobFailed({
        attemptCount,
        database: bindings.DB,
        errorCode,
        jobId: body.jobId,
        nowMs: startMs,
      });
      message.ack();
      return;
    }

    await recordJobAttempt({
      attemptCount,
      database: bindings.DB,
      errorCode,
      jobId: body.jobId,
      nowMs: startMs,
    });
    await requeueDelayedWakeup({
      bindings,
      delaySeconds: CHANNEL_FINAL_DELIVERY_RETRY_DELAY_SECONDS,
      jobId: body.jobId,
      message,
    });
  }
}
