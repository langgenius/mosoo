import { agentChannelBindingsTable, agentsTable } from "@mosoo/db";
import type { ChannelBindingId } from "@mosoo/id";
import { and, asc, eq, gt } from "drizzle-orm";

import { createErrorLogContext, logError, logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { startDiscordGatewayConnection } from "../discord/discord-gateway-connection-client";
import type { DiscordGatewayStartResult } from "../discord/discord-gateway.do";

const DISCORD_GATEWAY_CONNECTION_BATCH_SIZE = 50;

export interface DiscordGatewayConnectionMaintenanceResult {
  failed: number;
  started: number;
  total: number;
}

export type DiscordGatewayConnectionStarter = (
  bindings: ApiBindings,
  input: { bindingId: ChannelBindingId },
) => Promise<DiscordGatewayStartResult>;

async function listPublishedDiscordBindingIdPage(
  bindings: ApiBindings,
  input: { afterBindingId: ChannelBindingId | null },
): Promise<ChannelBindingId[]> {
  const predicates = [
    eq(agentChannelBindingsTable.provider, "discord"),
    eq(agentChannelBindingsTable.status, "active"),
    eq(agentsTable.status, "published"),
  ];

  if (input.afterBindingId) {
    predicates.push(gt(agentChannelBindingsTable.id, input.afterBindingId));
  }

  const rows = await getAppDatabase(bindings.DB)
    .select({ bindingId: agentChannelBindingsTable.id })
    .from(agentChannelBindingsTable)
    .innerJoin(agentsTable, eq(agentsTable.id, agentChannelBindingsTable.agentId))
    .where(and(...predicates))
    .orderBy(asc(agentChannelBindingsTable.id))
    .limit(DISCORD_GATEWAY_CONNECTION_BATCH_SIZE)
    .all();

  return rows.map((row) => row.bindingId);
}

async function listPublishedDiscordBindingIds(bindings: ApiBindings): Promise<ChannelBindingId[]> {
  const bindingIds: ChannelBindingId[] = [];
  let afterBindingId: ChannelBindingId | null = null;

  for (;;) {
    const page = await listPublishedDiscordBindingIdPage(bindings, { afterBindingId });

    if (page.length === 0) {
      return bindingIds;
    }

    bindingIds.push(...page);
    afterBindingId = page[page.length - 1] ?? null;

    if (page.length < DISCORD_GATEWAY_CONNECTION_BATCH_SIZE) {
      return bindingIds;
    }
  }
}

export async function runDiscordGatewayConnectionMaintenance(
  bindings: ApiBindings,
  _scheduledAt: Date,
  options: { startConnection?: DiscordGatewayConnectionStarter } = {},
): Promise<DiscordGatewayConnectionMaintenanceResult> {
  const bindingIds = await listPublishedDiscordBindingIds(bindings);
  const startConnection = options.startConnection ?? startDiscordGatewayConnection;
  let failed = 0;
  let started = 0;

  for (const bindingId of bindingIds) {
    try {
      const result = await startConnection(bindings, { bindingId });

      if (result.status === "started" || result.status === "already_started") {
        started += 1;
      }
    } catch (error) {
      failed += 1;
      logError("discord-gateway-connection-maintenance.start_failed", {
        ...createErrorLogContext(error),
        bindingId,
      });
    }
  }

  if (bindingIds.length > 0) {
    logInfo("discord-gateway-connection-maintenance.completed", {
      failed,
      started,
      total: bindingIds.length,
    });
  }

  return {
    failed,
    started,
    total: bindingIds.length,
  };
}
