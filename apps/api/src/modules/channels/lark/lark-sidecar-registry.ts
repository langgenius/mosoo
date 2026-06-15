// Lark Sidecar Registry — read model for the internal route used by
// the Node `lark-ws-sidecar.ts` process.
//
// The sidecar runs the official `@larksuiteoapi/node-sdk` `WSClient` (which
// can't run inside workerd). It calls
// `GET /api/v1/internal/lark-gateway/bindings` on a short polling
// interval to discover which Lark channel bindings need a long-connection.
// This module owns that read.
//
// The WebSocket sidecar path is intentionally disabled until it is
// end-to-end ready. This registry keeps the internal route callable, but it
// does not expose binding credentials to a sidecar process.
//
// When re-enabled, it should return bindings whose:
//   - provider     = "lark"
//   - status       = "active"
//   - agent.status = "published"
//   - credentials.connectionMode = "websocket"
//
// We also decrypt and surface the appId + appSecret so the sidecar can
// hand them straight to the SDK; the wire is the loopback HTTP call inside
// `just dev`, gated by the shared `MOSOO_LARK_SIDECAR_SECRET`, so the
// credentials never leave the developer's machine.

import { agentChannelBindingsTable, agentsTable } from "@mosoo/db";
import type { AgentId, ChannelBindingId } from "@mosoo/id";
import { and, asc, eq, gt } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { resolveAgentChannelBindingContextById } from "../application/channel-binding-context";
import { parseLarkCredentials } from "./lark-credentials";
import type { LarkChannelCredentials } from "./lark-credentials";

const LARK_SIDECAR_BINDING_BATCH_SIZE = 50;

export interface LarkSidecarBindingDescriptor {
  readonly agentId: AgentId;
  readonly agentStatus: string;
  readonly bindingId: ChannelBindingId;
  readonly credentials: LarkChannelCredentials;
}

async function listLarkBindingIdPage(
  bindings: ApiBindings,
  input: { afterBindingId: ChannelBindingId | null },
): Promise<ChannelBindingId[]> {
  const rows = await getAppDatabase(bindings.DB)
    .select({ bindingId: agentChannelBindingsTable.id })
    .from(agentChannelBindingsTable)
    .innerJoin(agentsTable, eq(agentsTable.id, agentChannelBindingsTable.agentId))
    .where(
      and(
        eq(agentChannelBindingsTable.provider, "lark"),
        eq(agentChannelBindingsTable.appId, agentsTable.appId),
        eq(agentChannelBindingsTable.status, "active"),
        eq(agentsTable.status, "published"),
        ...(input.afterBindingId ? [gt(agentChannelBindingsTable.id, input.afterBindingId)] : []),
      ),
    )
    .orderBy(asc(agentChannelBindingsTable.id))
    .limit(LARK_SIDECAR_BINDING_BATCH_SIZE)
    .all();
  return rows.map((row) => row.bindingId);
}

export async function listPublishedWebsocketLarkBindingsForSidecar(
  bindings: ApiBindings,
): Promise<LarkSidecarBindingDescriptor[]> {
  const descriptors: LarkSidecarBindingDescriptor[] = [];
  let afterBindingId: ChannelBindingId | null = null;

  for (;;) {
    const page = await listLarkBindingIdPage(bindings, { afterBindingId });
    if (page.length === 0) {
      return descriptors;
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
        if (credentials.connectionMode !== "websocket") {
          continue;
        }
        continue;
      } catch (error) {
        logError("lark.sidecar.registry.parse_failed", {
          ...createErrorLogContext(error),
          bindingId,
        });
      }
    }

    afterBindingId = page[page.length - 1] ?? null;
    if (page.length < LARK_SIDECAR_BINDING_BATCH_SIZE) {
      return descriptors;
    }
  }
}
