import { channelConnectionStatesTable } from "@mosoo/db";
import type {
  AgentChannelBindingProvider,
  ChannelConnectionStateId,
  ChannelConnectionStateRow,
  ChannelConnectionStateStatus,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { ChannelBindingId } from "@mosoo/id";
import { and, eq, gt, isNull, lte, or } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase, getD1ChangeCount } from "../../../platform/db/drizzle";
import type {
  ChannelConnectionKey,
  ChannelConnectionOwnerSnapshot,
} from "./channel-connection-health";

export interface ChannelConnectionStatePayload {
  readonly lastErrorCode?: string | null;
  readonly lastHeartbeatAtMs?: number | null;
  readonly lastInboundAtMs?: number | null;
  readonly lastPollAtMs?: number | null;
  readonly runtimeStateJson?: string;
  readonly status: ChannelConnectionStateStatus;
  readonly statusChangedAtMs: number;
}

export interface ChannelConnectionOwnerStateRecord {
  readonly runtimeStateJson: string;
  readonly snapshot: ChannelConnectionOwnerSnapshot;
}

function toRuntimeAccountId(accountId: string | null): string {
  return accountId ?? "";
}

function fromRuntimeAccountId(runtimeAccountId: string): string | null {
  return runtimeAccountId.length > 0 ? runtimeAccountId : null;
}

function toRuntimeKey(row: ChannelConnectionStateRow): ChannelConnectionKey {
  return {
    accountId: fromRuntimeAccountId(row.runtimeAccountId),
    bindingId: row.bindingId,
    provider: row.provider,
  };
}

function toRuntimeSnapshot(row: ChannelConnectionStateRow): ChannelConnectionOwnerSnapshot {
  return {
    key: toRuntimeKey(row),
    lastErrorCode: row.lastErrorCode,
    lastHeartbeatAtMs: row.lastHeartbeatAt,
    lastInboundAtMs: row.lastInboundAt,
    lastPollAtMs: row.lastPollAt,
    leaseExpiresAtMs: row.leaseExpiresAt,
    leaseOwnerId: row.leaseOwnerId,
    status: row.status,
    statusChangedAtMs: row.statusChangedAt,
  };
}

function toStateFields(state: ChannelConnectionStatePayload) {
  return {
    lastErrorCode: state.lastErrorCode ?? null,
    lastHeartbeatAt: state.lastHeartbeatAtMs ?? null,
    lastInboundAt: state.lastInboundAtMs ?? null,
    lastPollAt: state.lastPollAtMs ?? null,
    runtimeStateJson: state.runtimeStateJson ?? "{}",
    status: state.status,
    statusChangedAt: state.statusChangedAtMs,
  };
}

async function readRuntimeStateRow(
  database: D1Database,
  input: {
    accountId: string | null;
    bindingId: ChannelBindingId;
    provider: AgentChannelBindingProvider;
  },
): Promise<ChannelConnectionStateRow | null> {
  return (
    (await getAppDatabase(database)
      .select()
      .from(channelConnectionStatesTable)
      .where(
        and(
          eq(channelConnectionStatesTable.provider, input.provider),
          eq(channelConnectionStatesTable.bindingId, input.bindingId),
          eq(channelConnectionStatesTable.runtimeAccountId, toRuntimeAccountId(input.accountId)),
        ),
      )
      .limit(1)
      .get()) ?? null
  );
}

async function ensureRuntimeStateRow(
  database: D1Database,
  input: {
    accountId: string | null;
    bindingId: ChannelBindingId;
    nowMs: number;
    provider: AgentChannelBindingProvider;
  },
): Promise<void> {
  await getAppDatabase(database)
    .insert(channelConnectionStatesTable)
    .values({
      bindingId: input.bindingId,
      createdAt: input.nowMs,
      id: createPlatformId<ChannelConnectionStateId>(),
      lastErrorCode: null,
      lastHeartbeatAt: null,
      lastInboundAt: null,
      lastPollAt: null,
      leaseExpiresAt: null,
      leaseOwnerId: null,
      provider: input.provider,
      runtimeAccountId: toRuntimeAccountId(input.accountId),
      runtimeStateJson: "{}",
      status: "idle",
      statusChangedAt: input.nowMs,
      updatedAt: input.nowMs,
    })
    .onConflictDoNothing({
      target: [
        channelConnectionStatesTable.provider,
        channelConnectionStatesTable.bindingId,
        channelConnectionStatesTable.runtimeAccountId,
      ],
    })
    .run();
}

export async function claimChannelConnectionOwner(input: {
  accountId?: string | null;
  bindingId: ChannelBindingId;
  bindings: Pick<ApiBindings, "DB">;
  leaseDurationMs: number;
  nowMs: number;
  ownerId: string;
  provider: AgentChannelBindingProvider;
  state?: ChannelConnectionStatePayload;
}): Promise<ChannelConnectionOwnerSnapshot | null> {
  const accountId = input.accountId ?? null;
  const state: ChannelConnectionStatePayload = input.state ?? {
    status: "starting",
    statusChangedAtMs: input.nowMs,
  };

  await ensureRuntimeStateRow(input.bindings.DB, {
    accountId,
    bindingId: input.bindingId,
    nowMs: input.nowMs,
    provider: input.provider,
  });

  const result = await getAppDatabase(input.bindings.DB)
    .update(channelConnectionStatesTable)
    .set({
      leaseExpiresAt: input.nowMs + input.leaseDurationMs,
      leaseOwnerId: input.ownerId,
      ...toStateFields(state),
      updatedAt: input.nowMs,
    })
    .where(
      and(
        eq(channelConnectionStatesTable.provider, input.provider),
        eq(channelConnectionStatesTable.bindingId, input.bindingId),
        eq(channelConnectionStatesTable.runtimeAccountId, toRuntimeAccountId(accountId)),
        or(
          isNull(channelConnectionStatesTable.leaseExpiresAt),
          lte(channelConnectionStatesTable.leaseExpiresAt, input.nowMs),
          eq(channelConnectionStatesTable.leaseOwnerId, input.ownerId),
        ),
      ),
    )
    .run();

  if (getD1ChangeCount(result) === 0) {
    return null;
  }

  return readChannelConnectionOwnerSnapshot({
    accountId,
    bindingId: input.bindingId,
    bindings: input.bindings,
    provider: input.provider,
  });
}

export async function renewChannelConnectionOwnerLease(input: {
  accountId?: string | null;
  bindingId: ChannelBindingId;
  bindings: Pick<ApiBindings, "DB">;
  leaseDurationMs: number;
  nowMs: number;
  ownerId: string;
  provider: AgentChannelBindingProvider;
  state: ChannelConnectionStatePayload;
}): Promise<ChannelConnectionOwnerSnapshot | null> {
  const accountId = input.accountId ?? null;
  const result = await getAppDatabase(input.bindings.DB)
    .update(channelConnectionStatesTable)
    .set({
      leaseExpiresAt: input.nowMs + input.leaseDurationMs,
      ...toStateFields(input.state),
      updatedAt: input.nowMs,
    })
    .where(
      and(
        eq(channelConnectionStatesTable.provider, input.provider),
        eq(channelConnectionStatesTable.bindingId, input.bindingId),
        eq(channelConnectionStatesTable.runtimeAccountId, toRuntimeAccountId(accountId)),
        eq(channelConnectionStatesTable.leaseOwnerId, input.ownerId),
        gt(channelConnectionStatesTable.leaseExpiresAt, input.nowMs),
      ),
    )
    .run();

  if (getD1ChangeCount(result) === 0) {
    return null;
  }

  return readChannelConnectionOwnerSnapshot({
    accountId,
    bindingId: input.bindingId,
    bindings: input.bindings,
    provider: input.provider,
  });
}

export async function releaseChannelConnectionOwner(input: {
  accountId?: string | null;
  bindingId: ChannelBindingId;
  bindings: Pick<ApiBindings, "DB">;
  nowMs: number;
  ownerId: string;
  provider: AgentChannelBindingProvider;
  status?: Extract<ChannelConnectionStateStatus, "failed" | "idle" | "stopped">;
}): Promise<ChannelConnectionOwnerSnapshot | null> {
  const accountId = input.accountId ?? null;
  const result = await getAppDatabase(input.bindings.DB)
    .update(channelConnectionStatesTable)
    .set({
      leaseExpiresAt: null,
      leaseOwnerId: null,
      status: input.status ?? "stopped",
      statusChangedAt: input.nowMs,
      updatedAt: input.nowMs,
    })
    .where(
      and(
        eq(channelConnectionStatesTable.provider, input.provider),
        eq(channelConnectionStatesTable.bindingId, input.bindingId),
        eq(channelConnectionStatesTable.runtimeAccountId, toRuntimeAccountId(accountId)),
        eq(channelConnectionStatesTable.leaseOwnerId, input.ownerId),
      ),
    )
    .run();

  if (getD1ChangeCount(result) === 0) {
    return null;
  }

  return readChannelConnectionOwnerSnapshot({
    accountId,
    bindingId: input.bindingId,
    bindings: input.bindings,
    provider: input.provider,
  });
}

export async function completeChannelConnectionOwner(input: {
  accountId?: string | null;
  bindingId: ChannelBindingId;
  bindings: Pick<ApiBindings, "DB">;
  nowMs: number;
  ownerId: string;
  provider: AgentChannelBindingProvider;
  state: ChannelConnectionStatePayload;
}): Promise<ChannelConnectionOwnerSnapshot | null> {
  const accountId = input.accountId ?? null;
  const result = await getAppDatabase(input.bindings.DB)
    .update(channelConnectionStatesTable)
    .set({
      leaseExpiresAt: null,
      leaseOwnerId: null,
      ...toStateFields(input.state),
      updatedAt: input.nowMs,
    })
    .where(
      and(
        eq(channelConnectionStatesTable.provider, input.provider),
        eq(channelConnectionStatesTable.bindingId, input.bindingId),
        eq(channelConnectionStatesTable.runtimeAccountId, toRuntimeAccountId(accountId)),
        eq(channelConnectionStatesTable.leaseOwnerId, input.ownerId),
      ),
    )
    .run();

  if (getD1ChangeCount(result) === 0) {
    return null;
  }

  return readChannelConnectionOwnerSnapshot({
    accountId,
    bindingId: input.bindingId,
    bindings: input.bindings,
    provider: input.provider,
  });
}

export async function readChannelConnectionOwnerSnapshot(input: {
  accountId?: string | null;
  bindingId: ChannelBindingId;
  bindings: Pick<ApiBindings, "DB">;
  provider: AgentChannelBindingProvider;
}): Promise<ChannelConnectionOwnerSnapshot | null> {
  const row = await readRuntimeStateRow(input.bindings.DB, {
    accountId: input.accountId ?? null,
    bindingId: input.bindingId,
    provider: input.provider,
  });

  return row ? toRuntimeSnapshot(row) : null;
}

export async function readChannelConnectionOwnerState(input: {
  accountId?: string | null;
  bindingId: ChannelBindingId;
  bindings: Pick<ApiBindings, "DB">;
  provider: AgentChannelBindingProvider;
}): Promise<ChannelConnectionOwnerStateRecord | null> {
  const row = await readRuntimeStateRow(input.bindings.DB, {
    accountId: input.accountId ?? null,
    bindingId: input.bindingId,
    provider: input.provider,
  });

  if (!row) {
    return null;
  }

  return {
    runtimeStateJson: row.runtimeStateJson,
    snapshot: toRuntimeSnapshot(row),
  };
}
