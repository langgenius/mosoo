import { AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS } from "@mosoo/contracts/channel";
import type { ChannelBindingId } from "@mosoo/id";
import type { Hono } from "hono";

import { enqueueChannelWorkTriggerCommand } from "../../../modules/api-command/application/api-command-enqueue";
import { resolveAgentChannelBindingContextById } from "../../../modules/channels/application/channel-binding-context";
import { parseDiscordCredentials } from "../../../modules/channels/discord/discord-credentials";
import {
  normalizeDiscordGatewayWorkTrigger,
  parseDiscordGatewayDispatchEnvelope,
} from "../../../modules/channels/discord/discord-events";
import { DISCORD_FIRST_PARTY_ADAPTER_MANIFEST } from "../../../modules/channels/discord/discord-first-party-adapter";
import { verifyDiscordRelaySignature } from "../../../modules/channels/discord/discord-signing";
import { logInfo } from "../../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { toPlatformId } from "../../../shared/platform-id";
import { platformIdRouteErrorResponse } from "./platform-id-route-error";

function discordJson(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status });
}

export function registerDiscordEventsRoute(app: Hono<ApiGatewayEnvironment>) {
  app.post(AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS.discord, async (c) => {
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
      provider: "discord",
    });

    if (!binding) {
      logInfo("discord-channel-events.binding_not_found", { bindingId });
      return discordJson({ ignored: true, ok: true });
    }

    const credentials = parseDiscordCredentials(binding.credentialsJson);
    const signature = await verifyDiscordRelaySignature({
      body: rawBody,
      headers: c.req.raw.headers,
      relaySecret: credentials.relaySecret,
    });

    if (!signature.ok) {
      return discordJson(
        {
          code: signature.code,
          error: signature.message,
          ok: false,
        },
        signature.status,
      );
    }

    const parsed = parseDiscordGatewayDispatchEnvelope(rawBody);

    if (!parsed.ok) {
      if (parsed.code === "unsupported_dispatch") {
        logInfo("discord-channel-events.unsupported_dispatch_ignored", {
          bindingId: binding.bindingId,
          code: parsed.code,
        });
        return discordJson({ ignored: true, ok: true });
      }

      return discordJson({ code: parsed.code, error: parsed.message, ok: false }, 400);
    }

    const trigger = normalizeDiscordGatewayWorkTrigger(parsed.envelope, {
      botUserId: binding.externalBotId,
    });

    if (!trigger) {
      return discordJson({ ignored: true, ok: true });
    }

    if (binding.agentStatus !== "published") {
      logInfo("discord-channel-events.agent_unpublished", {
        agentId: binding.agentId,
        bindingId: binding.bindingId,
        eventId: trigger.eventId,
      });
      return discordJson({ ignored: true, ok: true });
    }

    await enqueueChannelWorkTriggerCommand(c.env, {
      bindingId: binding.bindingId,
      provider: "discord",
      requestUrl: c.req.url,
      trigger,
    });

    return discordJson({
      accepted: true,
      adapter: DISCORD_FIRST_PARTY_ADAPTER_MANIFEST.id,
      ok: true,
    });
  });
}
