// Lark long-connection maintenance service.
//
// Scope: typed ChannelConnection calls for Lark start, stop, and snapshot,
// plus a scheduled reconciler that ensures every
// `connectionMode="websocket"` Lark binding has a running connection.

import { agentChannelBindingsTable, agentsTable } from "@mosoo/db";
import type { ChannelBindingId } from "@mosoo/id";
import { and, asc, eq, gt } from "drizzle-orm";

import { createErrorLogContext, logError, logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { parseLarkCredentials } from "../lark/lark-credentials";
import type { LarkChannelCredentials } from "../lark/lark-credentials";
import type {
  LarkGatewaySnapshot,
  LarkGatewayStartResult,
  LarkGatewayStopResult,
} from "../lark/lark-gateway.do";
import { resolveAgentChannelBindingContextById } from "./channel-binding-context";
import {
  readChannelConnectionSnapshot,
  startChannelConnection,
  stopChannelConnection,
} from "./channel-connection-client";

export interface LarkGatewayBindingRecord {
  readonly bindingId: ChannelBindingId;
  readonly credentials: Pick<LarkChannelCredentials, "connectionMode">;
}

export interface ReconcileLarkLongConnectionsResult {
  readonly skippedDisabledWebsocketBindings: readonly ChannelBindingId[];
  readonly skippedWebhookBindings: readonly ChannelBindingId[];
  readonly startedBindings: readonly ChannelBindingId[];
  readonly errors: readonly { bindingId: ChannelBindingId; reason: string }[];
}

export async function startLarkLongConnection(input: {
  bindingId: ChannelBindingId;
  bindings: ApiBindings;
}): Promise<LarkGatewayStartResult> {
  return await startChannelConnection(input.bindings, {
    bindingId: input.bindingId,
    provider: "lark",
  });
}

export async function stopLarkLongConnection(input: {
  bindingId: ChannelBindingId;
  bindings: ApiBindings;
}): Promise<LarkGatewayStopResult> {
  return await stopChannelConnection(input.bindings, {
    bindingId: input.bindingId,
    provider: "lark",
  });
}

export async function readLarkLongConnectionSnapshot(input: {
  bindingId: ChannelBindingId;
  bindings: ApiBindings;
}): Promise<LarkGatewaySnapshot> {
  return await readChannelConnectionSnapshot(input.bindings, {
    bindingId: input.bindingId,
    provider: "lark",
  });
}

/**
 * Walk the supplied list of Lark bindings and ensure every one whose
 * credentials are in `websocket` mode has its connection started. Webhook-mode
 * bindings are explicitly skipped — they live on the HTTP route, not the
 * DO. Errors per-binding are accumulated and returned; one bad binding
 * does not abort the whole sweep.
 *
 * The DB list resolver is injected so the scheduled entry can wire it
 * after L-003 makes `connectionMode` part of the canonical creds schema.
 */
export async function reconcileLarkLongConnections(input: {
  bindings: ApiBindings;
  records: readonly LarkGatewayBindingRecord[];
}): Promise<ReconcileLarkLongConnectionsResult> {
  const skippedWebhookBindings: ChannelBindingId[] = [];
  const skippedDisabledWebsocketBindings: ChannelBindingId[] = [];
  const startedBindings: ChannelBindingId[] = [];
  const errors: { bindingId: ChannelBindingId; reason: string }[] = [];

  for (const record of input.records) {
    if (record.credentials.connectionMode !== "websocket") {
      skippedWebhookBindings.push(record.bindingId);
      continue;
    }

    skippedDisabledWebsocketBindings.push(record.bindingId);
  }

  logInfo("lark.gateway.maintenance.completed", {
    errorCount: errors.length,
    skippedDisabledWebsocketCount: skippedDisabledWebsocketBindings.length,
    skippedCount: skippedWebhookBindings.length,
    startedCount: startedBindings.length,
  });

  return { errors, skippedDisabledWebsocketBindings, skippedWebhookBindings, startedBindings };
}

const LARK_LONG_CONNECTION_BATCH_SIZE = 50;

async function listPublishedLarkBindingIdPage(
  bindings: ApiBindings,
  input: { afterBindingId: ChannelBindingId | null },
): Promise<ChannelBindingId[]> {
  const predicates = [
    eq(agentChannelBindingsTable.provider, "lark"),
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
    .limit(LARK_LONG_CONNECTION_BATCH_SIZE)
    .all();
  return rows.map((row) => row.bindingId);
}

async function listPublishedLarkBindingRecords(
  bindings: ApiBindings,
): Promise<LarkGatewayBindingRecord[]> {
  const records: LarkGatewayBindingRecord[] = [];
  let afterBindingId: ChannelBindingId | null = null;

  for (;;) {
    const page = await listPublishedLarkBindingIdPage(bindings, { afterBindingId });
    if (page.length === 0) {
      return records;
    }
    for (const bindingId of page) {
      try {
        const context = await resolveAgentChannelBindingContextById(bindings, {
          bindingId,
          provider: "lark",
        });
        if (!context) {
          continue;
        }
        const credentials = parseLarkCredentials(context.credentialsJson);
        records.push({ bindingId, credentials });
      } catch (error) {
        logError("lark.gateway.maintenance.parse_failed", {
          ...createErrorLogContext(error),
          bindingId,
        });
      }
    }
    afterBindingId = page[page.length - 1] ?? null;
    if (page.length < LARK_LONG_CONNECTION_BATCH_SIZE) {
      return records;
    }
  }
}

/**
 * Scheduled-tick entry. Pulls every active+published Lark binding,
 * parses its credentials, filters to `connectionMode="websocket"`, and
 * tells ChannelConnection to start its connection. Webhook-mode bindings are
 * explicitly skipped (they live on the HTTP route, not the DO).
 *
 * Mirrors the Discord/WeChat maintenance shape; only one signature
 * difference: this returns the dual-mode reconcile result (skipped vs
 * started) rather than the Discord {started, failed, total} struct so
 * the call site can log the webhook-skip count for observability.
 */
export async function runLarkLongConnectionMaintenance(
  bindings: ApiBindings,
  _scheduledAt: Date,
): Promise<ReconcileLarkLongConnectionsResult> {
  // When a Lark sidecar process is configured (dev-local injects
  // MOSOO_LARK_SIDECAR_SECRET when spawning bin/lark-ws-sidecar.ts),
  // the sidecar owns the long-connection lifecycle via the official
  // @larksuiteoapi/node-sdk WSClient. Don't also spin up the in-worker
  // Lark long-connection runtime — its protocol implementation is incomplete
  // (placeholder URL + JSON-assumed frames where Feishu sends protobuf)
  // and would just spam connect_failed every minute.
  if ((bindings.MOSOO_LARK_SIDECAR_SECRET ?? "").trim().length > 0) {
    logInfo("lark.gateway.maintenance.skipped_sidecar_active", {});
    return {
      errors: [],
      skippedDisabledWebsocketBindings: [],
      skippedWebhookBindings: [],
      startedBindings: [],
    };
  }

  const records = await listPublishedLarkBindingRecords(bindings);
  return await reconcileLarkLongConnections({ bindings, records });
}
