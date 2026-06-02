import type { ChannelBindingId } from "@mosoo/id";

import { logError, logInfo } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { resolveAgentChannelBindingContextById } from "../application/channel-binding-context";
import { createChannelFinalDeliveryScheduler } from "../application/channel-final-delivery.service";
import { createChannelSessionClient } from "../application/channel-session-command-client";
import { parseLarkCredentials } from "./lark-credentials";
import type { LarkChannelCredentials } from "./lark-credentials";
import { processLarkWorkTrigger } from "./lark-first-party-adapter";
import { LARK_LC_CONNECT_URL_PATH, LarkLongConnectionClient } from "./lark-long-connection-client";
import type {
  LarkLongConnectionCloseInfo,
  LarkLongConnectionSocket,
  LarkLongConnectionSocketFactory,
  LarkLongConnectionTriggerHandler,
} from "./lark-long-connection-client";
import { LarkWebApiClient, toLarkApiOrigin } from "./lark-web-api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Worker-native gateway wiring is retained for ChannelConnection runtimes
 * without the Node sidecar. Local dev skips it when the sidecar secret is set
 * because the official SDK owns Lark's protobuf long-connection there.
 */
export async function resolveLarkLongConnectionUrl(input: {
  credentials: LarkChannelCredentials;
}): Promise<string> {
  const apiClient = new LarkWebApiClient({
    appId: input.credentials.appId,
    appSecret: input.credentials.appSecret,
    domain: input.credentials.domain,
  });
  const tenantAccessToken = await apiClient.getTenantAccessToken();
  const response = await fetch(
    `${toLarkApiOrigin(input.credentials.domain)}${LARK_LC_CONNECT_URL_PATH}`,
    {
      body: JSON.stringify({ app_id: input.credentials.appId }),
      headers: {
        Authorization: `Bearer ${tenantAccessToken}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      method: "POST",
    },
  );

  if (!response.ok) {
    throw new Error(`Lark long-connection URL fetch failed: HTTP ${response.status}`);
  }

  const body: unknown = await response.json();

  if (!isRecord(body)) {
    throw new Error("Lark long-connection URL response is not a JSON object.");
  }

  const data = body["data"];
  if (!isRecord(data)) {
    throw new Error("Lark long-connection URL response missing data field.");
  }

  const url = data["url"];
  if (typeof url !== "string" || url.trim().length === 0) {
    throw new Error("Lark long-connection URL response missing data.url string.");
  }

  return url;
}

function createLarkTriggerDispatcher(input: {
  bindingId: ChannelBindingId;
  bindings: ApiBindings;
}): LarkLongConnectionTriggerHandler {
  return async ({ trigger }) => {
    const binding = await resolveAgentChannelBindingContextById(input.bindings, {
      bindingId: input.bindingId,
      provider: "lark",
    });
    if (!binding) {
      logError("lark.gateway.dispatch.binding_not_found", { bindingId: input.bindingId });
      return;
    }
    if (binding.agentStatus !== "published") {
      logInfo("lark.gateway.dispatch.agent_unpublished", {
        agentId: binding.agentId,
        bindingId: binding.bindingId,
        eventId: trigger.eventId,
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
        sessionLinkBaseUrl: input.bindings.WEB_ORIGIN,
      },
      finalDeliveryScheduler: createChannelFinalDeliveryScheduler(input.bindings),
      sessionClient: createChannelSessionClient({
        binding,
        bindings: input.bindings,
        executionContext: null,
        requestUrl: "lark-gateway://owner",
      }),
      trigger,
    });
  };
}

function workerSocketFactory(url: string): LarkLongConnectionSocket {
  const socket = new WebSocket(url);
  return {
    addEventListener: socket.addEventListener.bind(
      socket,
    ) as LarkLongConnectionSocket["addEventListener"],
    close: socket.close.bind(socket),
    send: socket.send.bind(socket),
  };
}

export function createLarkGatewayClient(input: {
  bindingId: ChannelBindingId;
  bindings: ApiBindings;
  onClose(info: LarkLongConnectionCloseInfo): void;
}): LarkLongConnectionClient {
  const factory: LarkLongConnectionSocketFactory = (url) => workerSocketFactory(url);
  const client = new LarkLongConnectionClient({ socketFactory: factory });

  client.onTrigger(createLarkTriggerDispatcher(input));
  client.onClose(input.onClose);
  client.onProtocolError(({ code, detail }) => {
    logError("lark.gateway.protocol_error", {
      bindingId: input.bindingId,
      code,
      detail,
    });
  });

  return client;
}
