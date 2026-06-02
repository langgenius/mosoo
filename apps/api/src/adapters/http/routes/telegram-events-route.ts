import { AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS } from "@mosoo/contracts/channel";
import type { ChannelBindingId } from "@mosoo/id";
import type { Hono } from "hono";

import { enqueueChannelWorkTriggerCommand } from "../../../modules/api-command/application/api-command-enqueue";
import { resolveAgentChannelBindingContextById } from "../../../modules/channels/application/channel-binding-context";
import { parseTelegramCredentials } from "../../../modules/channels/telegram/telegram-credentials";
import {
  normalizeTelegramWorkTrigger,
  parseTelegramUpdateEnvelope,
} from "../../../modules/channels/telegram/telegram-events";
import { TELEGRAM_FIRST_PARTY_ADAPTER_MANIFEST } from "../../../modules/channels/telegram/telegram-first-party-adapter";
import { verifyTelegramWebhookSecret } from "../../../modules/channels/telegram/telegram-signing";
import { logInfo } from "../../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { toPlatformId } from "../../../shared/platform-id";
import { platformIdRouteErrorResponse } from "./platform-id-route-error";

function telegramJson(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status });
}

export function registerTelegramEventsRoute(app: Hono<ApiGatewayEnvironment>) {
  app.post(AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS.telegram, async (c) => {
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

    const binding = await resolveAgentChannelBindingContextById(c.env, {
      bindingId,
      provider: "telegram",
    });

    if (!binding) {
      logInfo("telegram-channel-events.binding_not_found", { bindingId });
      return telegramJson({ ignored: true, ok: true });
    }

    const credentials = parseTelegramCredentials(binding.credentialsJson);
    const secret = verifyTelegramWebhookSecret({
      headers: c.req.raw.headers,
      webhookSecret: credentials.webhookSecret,
    });

    if (!secret.ok) {
      return telegramJson(
        {
          code: secret.code,
          error: secret.message,
          ok: false,
        },
        secret.status,
      );
    }

    const rawBody = await c.req.raw.clone().text();
    const parsed = parseTelegramUpdateEnvelope(rawBody);

    if (!parsed.ok) {
      if (parsed.code === "missing_message") {
        logInfo("telegram-channel-events.unsupported_update_ignored", {
          bindingId: binding.bindingId,
          code: parsed.code,
        });
        return telegramJson({ ignored: true, ok: true });
      }

      return telegramJson({ error: parsed.message, ok: false }, 400);
    }

    const trigger = normalizeTelegramWorkTrigger(parsed.envelope);

    if (!trigger) {
      return telegramJson({ ignored: true, ok: true });
    }

    if (binding.agentStatus !== "published") {
      logInfo("telegram-channel-events.agent_unpublished", {
        agentId: binding.agentId,
        bindingId: binding.bindingId,
        eventId: trigger.eventId,
      });
      return telegramJson({ ignored: true, ok: true });
    }

    await enqueueChannelWorkTriggerCommand(c.env, {
      bindingId: binding.bindingId,
      provider: "telegram",
      requestUrl: c.req.url,
      trigger,
    });

    return telegramJson({
      accepted: true,
      adapter: TELEGRAM_FIRST_PARTY_ADAPTER_MANIFEST.id,
      ok: true,
    });
  });
}
