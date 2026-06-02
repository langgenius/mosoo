import { AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS } from "@mosoo/contracts/channel";
import type { ChannelBindingId } from "@mosoo/id";
import type { Hono } from "hono";

import { enqueueChannelWorkTriggerCommand } from "../../../modules/api-command/application/api-command-enqueue";
import { resolveAgentChannelBindingContextById } from "../../../modules/channels/application/channel-binding-context";
import { parseLarkCredentials } from "../../../modules/channels/lark/lark-credentials";
import {
  normalizeLarkWorkTrigger,
  parseLarkEventsEnvelope,
  readLarkEventsBody,
} from "../../../modules/channels/lark/lark-events";
import { LARK_FIRST_PARTY_ADAPTER_MANIFEST } from "../../../modules/channels/lark/lark-first-party-adapter";
import { verifyLarkSignature } from "../../../modules/channels/lark/lark-signing";
import { logInfo } from "../../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { toPlatformId } from "../../../shared/platform-id";
import { platformIdRouteErrorResponse } from "./platform-id-route-error";

function larkJson(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status });
}

export function registerLarkEventsRoute(app: Hono<ApiGatewayEnvironment>) {
  app.post(AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS.lark, async (c) => {
    let bindingId: ChannelBindingId;

    try {
      bindingId = toPlatformId<ChannelBindingId>(c.req.param("bindingId"), "Channel binding ID");
    } catch (error) {
      const response = platformIdRouteErrorResponse(error, (message) => ({
        code: "invalid_request",
        error: message,
        ok: false,
      }));
      if (response !== null) {
        return response;
      }
      throw error;
    }

    const rawBody = await c.req.raw.clone().text();
    const binding = await resolveAgentChannelBindingContextById(c.env, {
      bindingId,
      provider: "lark",
    });

    if (!binding) {
      logInfo("lark-channel-events.binding_not_found", { bindingId });
      return larkJson({ ignored: true, ok: true });
    }

    const credentials = parseLarkCredentials(binding.credentialsJson);

    if (credentials.connectionMode === "websocket") {
      logInfo("channel.lark.webhook_received_on_websocket_binding", {
        bindingId: binding.bindingId,
      });
      return larkJson({ ignored: true, ok: true });
    }

    const encryptKey = credentials.encryptKey;
    const verificationToken = credentials.verificationToken;
    if (encryptKey === null || verificationToken === null) {
      throw new Error(
        "Lark webhook-mode binding had null signing fields after parseLarkCredentials.",
      );
    }

    const signature = await verifyLarkSignature({
      body: rawBody,
      encryptKey,
      headers: c.req.raw.headers,
    });

    if (!signature.ok) {
      return larkJson(
        {
          code: signature.code,
          error: signature.message,
          ok: false,
        },
        signature.status,
      );
    }

    const readableBody = await readLarkEventsBody({
      body: rawBody,
      encryptKey,
    });

    if (!readableBody.ok) {
      return larkJson({ code: readableBody.code, error: readableBody.message, ok: false }, 400);
    }

    const parsed = parseLarkEventsEnvelope(readableBody.body, {
      verificationToken,
    });

    if (!parsed.ok) {
      if (parsed.code === "unsupported_type") {
        logInfo("lark-channel-events.unsupported_event_ignored", {
          bindingId: binding.bindingId,
          code: parsed.code,
        });
        return larkJson({ ignored: true, ok: true });
      }

      return larkJson({ code: parsed.code, error: parsed.message, ok: false }, 400);
    }

    if (parsed.envelope.type === "url_verification") {
      return larkJson({ challenge: parsed.envelope.challenge });
    }

    const trigger = normalizeLarkWorkTrigger(parsed.envelope);

    if (binding.agentStatus !== "published") {
      logInfo("lark-channel-events.agent_unpublished", {
        agentId: binding.agentId,
        bindingId: binding.bindingId,
        eventId: trigger.eventId,
      });
      return larkJson({ ignored: true, ok: true });
    }

    await enqueueChannelWorkTriggerCommand(c.env, {
      bindingId: binding.bindingId,
      provider: "lark",
      requestUrl: c.req.url,
      trigger,
    });

    return larkJson({
      accepted: true,
      adapter: LARK_FIRST_PARTY_ADAPTER_MANIFEST.id,
      ok: true,
    });
  });
}
