import { AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS } from "@mosoo/contracts/channel";
import type { Hono } from "hono";

import { enqueueChannelWorkTriggerCommand } from "../../../modules/api-command/application/api-command-enqueue";
import { resolveSlackChannelBindingContext } from "../../../modules/channels/application/slack-channel-session.service";
import {
  normalizeSlackWorkTrigger,
  parseSlackEventsEnvelope,
} from "../../../modules/channels/slack/slack-events";
import { SLACK_FIRST_PARTY_ADAPTER_MANIFEST } from "../../../modules/channels/slack/slack-first-party-adapter";
import { verifySlackSignature } from "../../../modules/channels/slack/slack-signing";
import { logInfo } from "../../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";

function slackJson(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status });
}

function getSlackTenantId(trigger: { enterpriseId: string | null; teamId: string | null }) {
  return trigger.teamId ?? trigger.enterpriseId;
}

export function registerSlackEventsRoute(app: Hono<ApiGatewayEnvironment>) {
  app.post(AGENT_CHANNEL_WEBHOOK_ROUTE_PATTERNS.slack, async (c) => {
    const rawBody = await c.req.raw.clone().text();
    const parsed = parseSlackEventsEnvelope(rawBody);

    if (!parsed.ok) {
      if (parsed.code === "missing_event_id" || parsed.code === "unsupported_type") {
        logInfo(
          parsed.code === "missing_event_id"
            ? "slack-channel-events.missing_event_id"
            : "slack-channel-events.unsupported_event_ignored",
          { code: parsed.code },
        );
        return slackJson({ ignored: true, ok: true });
      }

      return slackJson({ error: parsed.message, ok: false }, 400);
    }

    if (parsed.envelope.type === "url_verification") {
      return c.text(parsed.envelope.challenge);
    }

    const trigger = normalizeSlackWorkTrigger(parsed.envelope);

    if (!trigger) {
      return slackJson({ ignored: true, ok: true });
    }

    if (!trigger.botUserId) {
      logInfo("slack-channel-events.missing_bot_user_id", {
        eventId: trigger.eventId,
        teamId: trigger.teamId,
      });
      return slackJson({ ignored: true, ok: true });
    }

    const tenantId = getSlackTenantId(trigger);

    if (!tenantId) {
      logInfo("slack-channel-events.missing_tenant_id", {
        botUserId: trigger.botUserId,
        eventId: trigger.eventId,
      });
      return slackJson({ ignored: true, ok: true });
    }

    const binding = await resolveSlackChannelBindingContext(c.env, {
      externalBotId: trigger.botUserId,
      externalTenantId: tenantId,
    });

    if (!binding) {
      logInfo("slack-channel-events.binding_not_found", {
        botUserId: trigger.botUserId,
        eventId: trigger.eventId,
        teamId: trigger.teamId,
      });
      return slackJson({ ignored: true, ok: true });
    }

    const signature = await verifySlackSignature({
      body: rawBody,
      headers: c.req.raw.headers,
      signingSecret: binding.credentials.signingSecret,
    });

    if (!signature.ok) {
      return slackJson(
        {
          code: signature.code,
          error: signature.message,
          ok: false,
        },
        signature.status,
      );
    }

    if (binding.agentStatus !== "published") {
      logInfo("slack-channel-events.agent_unpublished", {
        agentId: binding.agentId,
        bindingId: binding.bindingId,
        eventId: trigger.eventId,
        teamId: trigger.teamId,
      });
      return slackJson({ ignored: true, ok: true });
    }

    await enqueueChannelWorkTriggerCommand(c.env, {
      bindingId: binding.bindingId,
      provider: "slack",
      requestUrl: c.req.url,
      trigger,
    });

    return slackJson({
      accepted: true,
      adapter: SLACK_FIRST_PARTY_ADAPTER_MANIFEST.id,
      ok: true,
    });
  });
}
