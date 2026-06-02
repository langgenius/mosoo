import { agentChannelBindingsTable, agentsTable, wechatChannelAccountsTable } from "@mosoo/db";
import type { WeChatChannelAccountStatus } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { ChannelBindingId } from "@mosoo/id";
import { and, asc, eq, gt, or } from "drizzle-orm";

import { createErrorLogContext, logError, logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { processWeChatWorkTrigger } from "../wechat/wechat-first-party-adapter";
import { WeChatIlinkClient } from "../wechat/wechat-ilink-client";
import { WeChatPollingRuntimeOwner } from "../wechat/wechat-polling-owner";
import type { WeChatPollingOwnerPollResult } from "../wechat/wechat-polling-owner";
import {
  createWeChatPollingOwnerDatabaseStore,
  readWeChatChannelAccountWithCredentials,
} from "../wechat/wechat-runtime-store";
import type { WeChatChannelAccountWithCredentials } from "../wechat/wechat-runtime-store";
import { resolveAgentChannelBindingContextById } from "./channel-binding-context";
import {
  claimChannelConnectionOwner,
  completeChannelConnectionOwner,
  releaseChannelConnectionOwner,
} from "./channel-connection-state.service";
import { createChannelFinalDeliveryScheduler } from "./channel-final-delivery.service";
import { createChannelSessionClient } from "./channel-session-command-client";

const WECHAT_POLLING_OWNER_BATCH_SIZE = 20;
const WECHAT_POLLING_OWNER_LEASE_MS = 60 * 1000;
// Failed and starting rows are retried so provider errors or mid-claim crashes do not orphan polling.
const WECHAT_POLLING_OWNER_RETRY_STATUSES = [
  "failed",
  "idle",
  "reconnecting",
  "running",
  "stale",
  "starting",
] as const satisfies readonly WeChatChannelAccountStatus[];

export interface WeChatPollingOwnerMaintenanceResult {
  failed: number;
  polled: number;
  skipped: number;
  total: number;
}

export interface WeChatPollingOwnerPollAccountResult {
  code:
    | "account_not_found"
    | "binding_not_found"
    | "lease_lost"
    | "lease_unavailable"
    | "polled"
    | "status_not_pollable";
  pollResult?: WeChatPollingOwnerPollResult;
}

type WeChatPollingOwnerClient = Pick<WeChatIlinkClient, "getUpdates">;

export type WeChatPollingOwnerClientFactory = (
  account: WeChatChannelAccountWithCredentials,
) => WeChatPollingOwnerClient;

interface WeChatPollingOwnerOptions {
  clientFactory?: WeChatPollingOwnerClientFactory;
  executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
  nowMs?: () => number;
}

interface WeChatPollingAccountPageRow {
  accountId: ChannelBindingId;
}

function createOwnerAttemptId(accountId: ChannelBindingId): string {
  return `wechat-polling-owner:${accountId}:${createPlatformId()}`;
}

function isPollableWeChatAccountStatus(status: WeChatChannelAccountStatus): boolean {
  return WECHAT_POLLING_OWNER_RETRY_STATUSES.some((candidate) => candidate === status);
}

function toRuntimeStateJson(owner: WeChatPollingRuntimeOwner): string {
  return JSON.stringify(owner.getRuntimeState());
}

function logWeChatPollingOwnerLeaseLost(input: {
  accountId: string;
  bindingId: ChannelBindingId;
  ownerId: string;
  stage: "complete_error" | "complete_success";
}): void {
  logInfo("wechat-polling-owner-maintenance.lease_lost", {
    accountId: input.accountId,
    bindingId: input.bindingId,
    ownerId: input.ownerId,
    provider: "wechat",
    stage: input.stage,
  });
}

async function listPublishedWeChatPollingAccountPage(
  bindings: ApiBindings,
  input: { afterAccountId: ChannelBindingId | null },
): Promise<WeChatPollingAccountPageRow[]> {
  const predicates = [
    eq(agentChannelBindingsTable.provider, "wechat"),
    eq(agentChannelBindingsTable.status, "active"),
    eq(agentsTable.status, "published"),
    or(
      ...WECHAT_POLLING_OWNER_RETRY_STATUSES.map((status) =>
        eq(wechatChannelAccountsTable.status, status),
      ),
    ),
  ];

  if (input.afterAccountId) {
    predicates.push(gt(wechatChannelAccountsTable.id, input.afterAccountId));
  }

  return getAppDatabase(bindings.DB)
    .select({ accountId: wechatChannelAccountsTable.id })
    .from(wechatChannelAccountsTable)
    .innerJoin(
      agentChannelBindingsTable,
      eq(agentChannelBindingsTable.id, wechatChannelAccountsTable.id),
    )
    .innerJoin(agentsTable, eq(agentsTable.id, agentChannelBindingsTable.agentId))
    .where(and(...predicates))
    .orderBy(asc(wechatChannelAccountsTable.id))
    .limit(WECHAT_POLLING_OWNER_BATCH_SIZE)
    .all();
}

async function listPublishedWeChatPollingAccountIds(
  bindings: ApiBindings,
): Promise<ChannelBindingId[]> {
  const accountIds: ChannelBindingId[] = [];
  let afterAccountId: ChannelBindingId | null = null;

  for (;;) {
    const page = await listPublishedWeChatPollingAccountPage(bindings, { afterAccountId });

    if (page.length === 0) {
      return accountIds;
    }

    accountIds.push(...page.map((row) => row.accountId));
    afterAccountId = page[page.length - 1]?.accountId ?? null;

    if (page.length < WECHAT_POLLING_OWNER_BATCH_SIZE) {
      return accountIds;
    }
  }
}

export async function pollWeChatChannelAccountOnce(
  bindings: ApiBindings,
  input: {
    accountId: ChannelBindingId;
    clientFactory?: WeChatPollingOwnerClientFactory;
    executionContext?: Pick<ExecutionContext, "waitUntil"> | null;
    nowMs?: () => number;
  },
): Promise<WeChatPollingOwnerPollAccountResult> {
  const nowMs = input.nowMs ?? currentTimestampMs;
  const account = await readWeChatChannelAccountWithCredentials(bindings, {
    accountId: input.accountId,
  });

  if (!account) {
    return { code: "account_not_found" };
  }

  if (!isPollableWeChatAccountStatus(account.account.status)) {
    return { code: "status_not_pollable" };
  }

  const ownerId = createOwnerAttemptId(account.account.id);
  const claimNowMs = nowMs();
  const claimed = await claimChannelConnectionOwner({
    accountId: account.account.externalAccountId,
    bindingId: account.account.id,
    bindings,
    leaseDurationMs: WECHAT_POLLING_OWNER_LEASE_MS,
    nowMs: claimNowMs,
    ownerId,
    provider: "wechat",
    state: {
      status: "starting",
      statusChangedAtMs: claimNowMs,
    },
  });

  if (!claimed) {
    return { code: "lease_unavailable" };
  }

  const binding = await resolveAgentChannelBindingContextById(bindings, {
    bindingId: account.account.id,
    provider: "wechat",
  });

  if (!binding) {
    await releaseChannelConnectionOwner({
      accountId: account.account.externalAccountId,
      bindingId: account.account.id,
      bindings,
      nowMs: nowMs(),
      ownerId,
      provider: "wechat",
      status: "failed",
    });
    return { code: "binding_not_found" };
  }

  const owner = new WeChatPollingRuntimeOwner({
    accountId: account.account.externalAccountId,
    bindingId: account.account.id,
    botId: account.account.externalBotId,
    client:
      input.clientFactory?.(account) ??
      new WeChatIlinkClient({
        baseUrl: account.credentials.baseUrl,
        botToken: account.credentials.botToken,
      }),
    nowMs,
    onTrigger: (trigger) =>
      processWeChatWorkTrigger({
        bindings,
        config: {
          agentId: binding.agentId,
          bindingId: binding.bindingId,
          sessionLinkBaseUrl: bindings.WEB_ORIGIN,
        },
        finalDeliveryScheduler: createChannelFinalDeliveryScheduler(bindings),
        sessionClient: createChannelSessionClient({
          binding,
          bindings,
          executionContext: input.executionContext ?? null,
          requestUrl: "scheduled://wechat-polling-owner",
        }),
        trigger,
      }),
    store: createWeChatPollingOwnerDatabaseStore(bindings),
  });

  try {
    const pollResult = await owner.pollOnce();
    const snapshot = owner.getSnapshot();

    const completed = await completeChannelConnectionOwner({
      accountId: account.account.externalAccountId,
      bindingId: account.account.id,
      bindings,
      nowMs: nowMs(),
      ownerId,
      provider: "wechat",
      state: {
        lastErrorCode: snapshot.lastErrorCode,
        lastHeartbeatAtMs: snapshot.lastHeartbeatAtMs,
        lastInboundAtMs: snapshot.lastInboundAtMs,
        lastPollAtMs: snapshot.lastPollAtMs,
        runtimeStateJson: toRuntimeStateJson(owner),
        status: snapshot.status,
        statusChangedAtMs: snapshot.statusChangedAtMs,
      },
    });

    if (!completed) {
      logWeChatPollingOwnerLeaseLost({
        accountId: account.account.externalAccountId,
        bindingId: account.account.id,
        ownerId,
        stage: "complete_success",
      });
      return { code: "lease_lost", pollResult };
    }

    return { code: "polled", pollResult };
  } catch (error) {
    const snapshot = owner.getSnapshot();

    const completed = await completeChannelConnectionOwner({
      accountId: account.account.externalAccountId,
      bindingId: account.account.id,
      bindings,
      nowMs: nowMs(),
      ownerId,
      provider: "wechat",
      state: {
        lastErrorCode: snapshot.lastErrorCode ?? "poll_failed",
        lastHeartbeatAtMs: snapshot.lastHeartbeatAtMs,
        lastInboundAtMs: snapshot.lastInboundAtMs,
        lastPollAtMs: snapshot.lastPollAtMs,
        runtimeStateJson: toRuntimeStateJson(owner),
        status: "failed",
        statusChangedAtMs: snapshot.statusChangedAtMs,
      },
    });

    if (!completed) {
      logWeChatPollingOwnerLeaseLost({
        accountId: account.account.externalAccountId,
        bindingId: account.account.id,
        ownerId,
        stage: "complete_error",
      });
    }
    throw error;
  }
}

export async function runWeChatPollingOwnerMaintenance(
  bindings: ApiBindings,
  _scheduledAt: Date,
  options: WeChatPollingOwnerOptions = {},
): Promise<WeChatPollingOwnerMaintenanceResult> {
  const accountIds = await listPublishedWeChatPollingAccountIds(bindings);
  let failed = 0;
  let polled = 0;
  let skipped = 0;

  for (const accountId of accountIds) {
    try {
      const result = await pollWeChatChannelAccountOnce(bindings, {
        accountId,
        ...(options.clientFactory ? { clientFactory: options.clientFactory } : {}),
        ...(options.executionContext !== undefined
          ? { executionContext: options.executionContext }
          : {}),
        ...(options.nowMs ? { nowMs: options.nowMs } : {}),
      });

      if (result.code === "polled") {
        polled += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      logError("wechat-polling-owner-maintenance.poll_failed", {
        ...createErrorLogContext(error),
        accountId,
      });
    }
  }

  // Zero-account ticks prove the scheduled cron fired.
  logInfo("wechat-polling-owner-maintenance.completed", {
    failed,
    polled,
    skipped,
    total: accountIds.length,
  });

  return {
    failed,
    polled,
    skipped,
    total: accountIds.length,
  };
}
