import { apiCommandsTable, appDeploymentRunsTable } from "@mosoo/db";
import type { ApiCommandId } from "@mosoo/db";
import type { AppDeploymentRunId } from "@mosoo/id";
import { parsePlatformId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import { createErrorLogContext, logError, logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { ACTIVE_APP_DEPLOYMENT_RUN_STATUSES } from "../../apps/domain/app-deployment-lifecycle";
import { cleanupOrphanChannelBindingCredentialSecrets } from "../../channels/application/agent-channel-binding-maintenance.service";
import { resolveAgentChannelBindingContextById } from "../../channels/application/channel-binding-context";
import { createChannelFinalDeliveryScheduler } from "../../channels/application/channel-final-delivery.service";
import { createChannelSessionClient } from "../../channels/application/channel-session-command-client";
import { runDiscordGatewayConnectionMaintenance } from "../../channels/application/discord-gateway-connection-maintenance.service";
import { runLarkLongConnectionMaintenance } from "../../channels/application/lark-long-connection-maintenance.service";
import {
  createSlackAdapterConfig,
  createSlackChannelSessionClient,
  resolveSlackChannelBindingContextById,
} from "../../channels/application/slack-channel-session.service";
import { runWeChatPollingOwnerMaintenance } from "../../channels/application/wechat-polling-owner-maintenance.service";
import { parseDiscordCredentials } from "../../channels/discord/discord-credentials";
import { processDiscordWorkTrigger } from "../../channels/discord/discord-first-party-adapter";
import { parseLarkCredentials } from "../../channels/lark/lark-credentials";
import { processLarkWorkTrigger } from "../../channels/lark/lark-first-party-adapter";
import { processSlackWorkTrigger } from "../../channels/slack/slack-first-party-adapter";
import { parseTelegramCredentials } from "../../channels/telegram/telegram-credentials";
import { processTelegramWorkTrigger } from "../../channels/telegram/telegram-first-party-adapter";
import { runUsageDailyRollup } from "../../cost/application/cost-rollup.service";
import { runSandboxMaintenance } from "../../runtime/application/runtime-maintenance.service";
import { dispatchQueuedSessionRun } from "../../runtime/application/session-runs/dispatch-queued-run.service";
import {
  claimApiCommand,
  completeApiCommand,
  markApiCommandDeadLettered,
  markApiCommandFailed,
  releaseApiCommandForRetry,
} from "./api-command-ledger";
import { APP_DEPLOYMENT_RUN_DISPATCH_DEDUPE_PREFIX } from "./api-command-enqueue";
import { parseApiCommandMessage } from "./api-command-message";
import type { ApiCommandMessage } from "./api-command-message";
import { ApiCommandPayloadError, parseApiCommandPayload } from "./api-command-payload";
import type {
  AppDeploymentRunDispatchCommandPayload,
  ChannelWorkTriggerCommandPayload,
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

async function processScheduledMaintenanceCommand(
  bindings: ApiBindings,
  payload: ScheduledMaintenanceCommandPayload,
): Promise<void> {
  const scheduledAt = new Date(payload.scheduledTime);
  const tasks: Promise<unknown>[] = [
    runSandboxMaintenance(bindings),
    runDiscordGatewayConnectionMaintenance(bindings, scheduledAt),
    cleanupOrphanChannelBindingCredentialSecrets(bindings, scheduledAt),
    runLarkLongConnectionMaintenance(bindings, scheduledAt),
    runWeChatPollingOwnerMaintenance(bindings, scheduledAt, { executionContext: null }),
  ];

  if (shouldRunUsageDailyRollup(scheduledAt)) {
    tasks.push(runUsageDailyRollup(bindings, scheduledAt));
  }

  await Promise.all(tasks);
}

async function processSlackChannelWorkTrigger(
  bindings: ApiBindings,
  payload: Extract<ChannelWorkTriggerCommandPayload, { provider: "slack" }>,
): Promise<void> {
  const binding = await resolveSlackChannelBindingContextById(bindings, {
    bindingId: payload.bindingId,
  });

  if (!binding) {
    logInfo("api-command.channel_work_trigger.binding_not_found", {
      bindingId: payload.bindingId,
      provider: payload.provider,
    });
    return;
  }

  if (binding.agentStatus !== "published") {
    logInfo("api-command.channel_work_trigger.agent_unpublished", {
      agentId: binding.agentId,
      bindingId: binding.bindingId,
      eventId: payload.trigger.eventId,
      provider: payload.provider,
    });
    return;
  }

  await processSlackWorkTrigger({
    config: createSlackAdapterConfig({
      binding,
      sessionLinkBaseUrl: bindings.WEB_ORIGIN,
    }),
    finalDeliveryScheduler: createChannelFinalDeliveryScheduler(bindings),
    sessionClient: createSlackChannelSessionClient({
      binding,
      bindings,
      executionContext: null,
      requestUrl: payload.requestUrl,
    }),
    trigger: payload.trigger,
  });
}

async function processTelegramChannelWorkTrigger(
  bindings: ApiBindings,
  payload: Extract<ChannelWorkTriggerCommandPayload, { provider: "telegram" }>,
): Promise<void> {
  const binding = await resolveAgentChannelBindingContextById(bindings, {
    bindingId: payload.bindingId,
    provider: payload.provider,
  });

  if (!binding) {
    logInfo("api-command.channel_work_trigger.binding_not_found", {
      bindingId: payload.bindingId,
      provider: payload.provider,
    });
    return;
  }

  if (binding.agentStatus !== "published") {
    logInfo("api-command.channel_work_trigger.agent_unpublished", {
      agentId: binding.agentId,
      bindingId: binding.bindingId,
      eventId: payload.trigger.eventId,
      provider: payload.provider,
    });
    return;
  }

  const credentials = parseTelegramCredentials(binding.credentialsJson);

  await processTelegramWorkTrigger({
    config: {
      agentId: binding.agentId,
      bindingId: binding.bindingId,
      botToken: credentials.botToken,
      sessionLinkBaseUrl: bindings.WEB_ORIGIN,
    },
    finalDeliveryScheduler: createChannelFinalDeliveryScheduler(bindings),
    sessionClient: createChannelSessionClient({
      binding,
      bindings,
      executionContext: null,
      requestUrl: payload.requestUrl,
    }),
    trigger: payload.trigger,
  });
}

async function processDiscordChannelWorkTrigger(
  bindings: ApiBindings,
  payload: Extract<ChannelWorkTriggerCommandPayload, { provider: "discord" }>,
): Promise<void> {
  const binding = await resolveAgentChannelBindingContextById(bindings, {
    bindingId: payload.bindingId,
    provider: payload.provider,
  });

  if (!binding) {
    logInfo("api-command.channel_work_trigger.binding_not_found", {
      bindingId: payload.bindingId,
      provider: payload.provider,
    });
    return;
  }

  if (binding.agentStatus !== "published") {
    logInfo("api-command.channel_work_trigger.agent_unpublished", {
      agentId: binding.agentId,
      bindingId: binding.bindingId,
      eventId: payload.trigger.eventId,
      provider: payload.provider,
    });
    return;
  }

  const credentials = parseDiscordCredentials(binding.credentialsJson);
  const result = await processDiscordWorkTrigger({
    config: {
      agentId: binding.agentId,
      bindingId: binding.bindingId,
      botToken: credentials.botToken,
      sessionLinkBaseUrl: bindings.WEB_ORIGIN,
    },
    finalDeliveryScheduler: createChannelFinalDeliveryScheduler(bindings),
    sessionClient: createChannelSessionClient({
      binding,
      bindings,
      executionContext: null,
      requestUrl: payload.requestUrl,
    }),
    trigger: payload.trigger,
  });

  if (!result.ok) {
    const error = new Error("Discord work trigger processing failed.");
    error.name = result.code;
    throw error;
  }
}

async function processLarkChannelWorkTrigger(
  bindings: ApiBindings,
  payload: Extract<ChannelWorkTriggerCommandPayload, { provider: "lark" }>,
): Promise<void> {
  const binding = await resolveAgentChannelBindingContextById(bindings, {
    bindingId: payload.bindingId,
    provider: payload.provider,
  });

  if (!binding) {
    logInfo("api-command.channel_work_trigger.binding_not_found", {
      bindingId: payload.bindingId,
      provider: payload.provider,
    });
    return;
  }

  if (binding.agentStatus !== "published") {
    logInfo("api-command.channel_work_trigger.agent_unpublished", {
      agentId: binding.agentId,
      bindingId: binding.bindingId,
      eventId: payload.trigger.eventId,
      provider: payload.provider,
    });
    return;
  }

  const credentials = parseLarkCredentials(binding.credentialsJson);

  await processLarkWorkTrigger({
    config: {
      agentId: binding.agentId,
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      bindingId: binding.bindingId,
      connectionMode: credentials.connectionMode,
      domain: credentials.domain,
      sessionLinkBaseUrl: bindings.WEB_ORIGIN,
    },
    finalDeliveryScheduler: createChannelFinalDeliveryScheduler(bindings),
    sessionClient: createChannelSessionClient({
      binding,
      bindings,
      executionContext: null,
      requestUrl: payload.requestUrl,
    }),
    trigger: payload.trigger,
  });
}

async function processChannelWorkTriggerCommand(
  bindings: ApiBindings,
  payload: ChannelWorkTriggerCommandPayload,
): Promise<void> {
  switch (payload.provider) {
    case "discord": {
      await processDiscordChannelWorkTrigger(bindings, payload);
      return;
    }
    case "lark": {
      await processLarkChannelWorkTrigger(bindings, payload);
      return;
    }
    case "slack": {
      await processSlackChannelWorkTrigger(bindings, payload);
      return;
    }
    case "telegram": {
      await processTelegramChannelWorkTrigger(bindings, payload);
      return;
    }
  }
}

async function processSessionRunDispatchCommand(
  bindings: ApiBindings,
  payload: SessionRunDispatchCommandPayload,
): Promise<void> {
  await dispatchQueuedSessionRun({
    bindings,
    input: {
      attachmentIds: payload.attachmentIds,
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

async function failActiveAppDeploymentRun(
  bindings: ApiBindings,
  runId: AppDeploymentRunId,
  input: { errorCode: string; errorMessage: string; nowMs: number },
): Promise<void> {
  await getAppDatabase(bindings.DB)
    .update(appDeploymentRunsTable)
    .set({
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      status: "failed",
      updatedAt: input.nowMs,
    })
    .where(
      and(
        eq(appDeploymentRunsTable.id, runId),
        inArray(appDeploymentRunsTable.status, ACTIVE_APP_DEPLOYMENT_RUN_STATUSES),
      ),
    )
    .run();
}

async function processAppDeploymentRunDispatchCommand(
  bindings: ApiBindings,
  payload: AppDeploymentRunDispatchCommandPayload,
): Promise<void> {
  await failActiveAppDeploymentRun(bindings, payload.appDeploymentRunId, {
    errorCode: "deployment_executor_not_implemented",
    errorMessage: "App deployment executor is not implemented.",
    nowMs: currentTimestampMs(),
  });
}

async function failAppDeploymentRunFromPayloadJson(
  bindings: ApiBindings,
  input: {
    errorCode: string;
    errorMessage: string;
    fallbackDedupeKey?: string;
    nowMs: number;
    payloadJson: string;
  },
): Promise<void> {
  const runId = readAppDeploymentRunIdFromPayload(input);

  if (runId === null) {
    return;
  }

  await failActiveAppDeploymentRun(bindings, runId, input);
}

async function tryFailAppDeploymentRunFromPayloadJson(
  bindings: ApiBindings,
  input: {
    errorCode: string;
    errorMessage: string;
    fallbackDedupeKey?: string;
    nowMs: number;
    payloadJson: string;
  },
  eventName: string,
): Promise<void> {
  try {
    await failAppDeploymentRunFromPayloadJson(bindings, input);
  } catch (error) {
    logError(eventName, {
      ...createErrorLogContext(error),
      errorCode: getErrorCode(error),
    });
  }
}

function readAppDeploymentRunIdFromPayload(input: {
  fallbackDedupeKey?: string;
  payloadJson: string;
}): AppDeploymentRunId | null {
  try {
    return (
      parseApiCommandPayload(
        "app_deployment_run_dispatch",
        input.payloadJson,
      ) as AppDeploymentRunDispatchCommandPayload
    ).appDeploymentRunId;
  } catch (error) {
    logError("api-command.app_deployment_run_payload_invalid", {
      ...createErrorLogContext(error),
      errorCode: getErrorCode(error),
    });
  }

  if (input.fallbackDedupeKey === undefined) {
    return null;
  }

  if (!input.fallbackDedupeKey.startsWith(APP_DEPLOYMENT_RUN_DISPATCH_DEDUPE_PREFIX)) {
    return null;
  }

  try {
    return parsePlatformId<AppDeploymentRunId>(
      input.fallbackDedupeKey.slice(APP_DEPLOYMENT_RUN_DISPATCH_DEDUPE_PREFIX.length),
      "app deployment run dispatch dedupe key",
    );
  } catch (error) {
    logError("api-command.app_deployment_run_dedupe_invalid", {
      ...createErrorLogContext(error),
      errorCode: getErrorCode(error),
    });
    return null;
  }
}

async function processClaimedApiCommand(
  bindings: ApiBindings,
  claim: NonNullable<Awaited<ReturnType<typeof claimApiCommand>>>,
): Promise<void> {
  const payload = parseApiCommandPayload(claim.kind, claim.payloadJson);

  switch (claim.kind) {
    case "app_deployment_run_dispatch": {
      await processAppDeploymentRunDispatchCommand(
        bindings,
        payload as AppDeploymentRunDispatchCommandPayload,
      );
      return;
    }
    case "channel_work_trigger": {
      await processChannelWorkTriggerCommand(bindings, payload as ChannelWorkTriggerCommandPayload);
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

    if (claim.kind === "app_deployment_run_dispatch") {
      const failedAtMs = nowMs();
      await tryFailAppDeploymentRunFromPayloadJson(
        bindings,
        {
          errorCode,
          errorMessage,
          fallbackDedupeKey: claim.dedupeKey,
          nowMs: failedAtMs,
          payloadJson: claim.payloadJson,
        },
        "api-command.app_deployment_run_fail_failed",
      );

      await markApiCommandFailed({
        commandId,
        database: bindings.DB,
        errorCode,
        errorMessage,
        nowMs: failedAtMs,
        ownerId,
      });
      message.ack();
      return;
    }

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
          dedupeKey: apiCommandsTable.dedupeKey,
          kind: apiCommandsTable.kind,
          payloadJson: apiCommandsTable.payloadJson,
        })
        .from(apiCommandsTable)
        .where(eq(apiCommandsTable.id, commandId))
        .limit(1)
        .get()) ?? null;

    if (command?.kind === "app_deployment_run_dispatch") {
      await tryFailAppDeploymentRunFromPayloadJson(
        bindings,
        {
          errorCode: "queue_dead_lettered",
          errorMessage: "Deployment dispatch reached the queue dead-letter consumer.",
          fallbackDedupeKey: command.dedupeKey,
          nowMs: deadLetteredAtMs,
          payloadJson: command.payloadJson,
        },
        "api-command.app_deployment_run_dead_letter_fail_failed",
      );
    }

    await markApiCommandDeadLettered({
      commandId,
      database: bindings.DB,
      errorCode: "queue_dead_lettered",
      errorMessage: "API command reached the queue dead-letter consumer.",
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
