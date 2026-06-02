// Local Lark sidecar endpoints. They are enabled only when
// MOSOO_LARK_SIDECAR_SECRET is present and every request carries it.

import type { ChannelBindingId } from "@mosoo/id";
import type { Hono } from "hono";

import { enqueueChannelWorkTriggerCommand } from "../../../modules/api-command/application/api-command-enqueue";
import { resolveAgentChannelBindingContextById } from "../../../modules/channels/application/channel-binding-context";
import { parseLarkCredentials } from "../../../modules/channels/lark/lark-credentials";
import {
  decodeLarkEventCallbackEnvelope,
  normalizeLarkWorkTrigger,
} from "../../../modules/channels/lark/lark-events";
import { LARK_FIRST_PARTY_ADAPTER_MANIFEST } from "../../../modules/channels/lark/lark-first-party-adapter";
import { listPublishedWebsocketLarkBindingsForSidecar } from "../../../modules/channels/lark/lark-sidecar-registry";
import type { LarkSidecarBindingDescriptor } from "../../../modules/channels/lark/lark-sidecar-registry";
import { logInfo } from "../../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { toPlatformId } from "../../../shared/platform-id";
import { platformIdRouteErrorResponse } from "./platform-id-route-error";

const SIDECAR_AUTH_HEADER = "x-sidecar-auth";
const secretEncoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sidecarSecretFromEnv(env: { MOSOO_LARK_SIDECAR_SECRET?: string }): string | null {
  const value = env.MOSOO_LARK_SIDECAR_SECRET?.trim();
  return value && value.length > 0 ? value : null;
}

function rejectUnauthenticated(): Response {
  return Response.json({ error: "sidecar auth required", ok: false }, { status: 401 });
}

function rejectDisabled(): Response {
  return Response.json(
    {
      error: "Lark sidecar endpoints are disabled in this environment.",
      ok: false,
    },
    { status: 404 },
  );
}

async function hashSidecarSecret(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", secretEncoder.encode(value)));
}

async function matchesSidecarSecret(
  submitted: string | undefined,
  configured: string,
): Promise<boolean> {
  if (!submitted) {
    return false;
  }

  const [submittedHash, configuredHash] = await Promise.all([
    hashSidecarSecret(submitted),
    hashSidecarSecret(configured),
  ]);
  let diff = submittedHash.length ^ configuredHash.length;
  const length = Math.max(submittedHash.length, configuredHash.length);

  for (let index = 0; index < length; index += 1) {
    diff |= (submittedHash[index] ?? 0) ^ (configuredHash[index] ?? 0);
  }

  return diff === 0;
}

interface DescriptorPayload {
  appId: string;
  appSecret: string;
  bindingId: string;
  domain: "feishu" | "lark";
}

function toDescriptorPayload(record: LarkSidecarBindingDescriptor): DescriptorPayload {
  return {
    appId: record.credentials.appId,
    appSecret: record.credentials.appSecret,
    bindingId: record.bindingId,
    domain: record.credentials.domain,
  };
}

export function registerLarkGatewayInternalRoute(app: Hono<ApiGatewayEnvironment>) {
  app.get("/v1/internal/lark-gateway/bindings", async (c) => {
    const configured = sidecarSecretFromEnv(c.env);
    if (configured === null) {
      return rejectDisabled();
    }

    const submitted = c.req.header(SIDECAR_AUTH_HEADER);
    if (!(await matchesSidecarSecret(submitted, configured))) {
      return rejectUnauthenticated();
    }

    const descriptors = await listPublishedWebsocketLarkBindingsForSidecar(c.env);
    return Response.json({
      bindings: descriptors.map(toDescriptorPayload),
      ok: true,
    });
  });

  app.post("/v1/internal/lark-gateway/event/:bindingId", async (c) => {
    const configured = sidecarSecretFromEnv(c.env);
    if (configured === null) {
      return rejectDisabled();
    }

    const submitted = c.req.header(SIDECAR_AUTH_HEADER);
    if (!(await matchesSidecarSecret(submitted, configured))) {
      return rejectUnauthenticated();
    }

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
      provider: "lark",
    });

    if (!binding) {
      logInfo("lark.sidecar.binding_not_found", { bindingId });
      return Response.json({ ignored: true, ok: true });
    }

    const credentials = parseLarkCredentials(binding.credentialsJson);
    if (credentials.connectionMode !== "websocket") {
      logInfo("lark.sidecar.binding_not_websocket", { bindingId: binding.bindingId });
      return Response.json({ ignored: true, ok: true });
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return Response.json({ error: "request body must be JSON", ok: false }, { status: 400 });
    }

    const envelopeCandidate = isRecord(body) ? body["envelope"] : undefined;
    const decoded = decodeLarkEventCallbackEnvelope(envelopeCandidate);

    if (!decoded.ok) {
      if (decoded.code === "unsupported_type") {
        logInfo("lark.sidecar.unsupported_event_ignored", {
          bindingId: binding.bindingId,
          code: decoded.code,
        });
        return Response.json({ ignored: true, ok: true });
      }

      return Response.json(
        { code: decoded.code, error: decoded.message, ok: false },
        { status: 400 },
      );
    }

    if (binding.agentStatus !== "published") {
      logInfo("lark.sidecar.agent_unpublished", {
        agentId: binding.agentId,
        bindingId: binding.bindingId,
      });
      return Response.json({ ignored: true, ok: true });
    }

    const trigger = normalizeLarkWorkTrigger(decoded.envelope);

    await enqueueChannelWorkTriggerCommand(c.env, {
      bindingId: binding.bindingId,
      provider: "lark",
      requestUrl: c.req.url,
      trigger,
    });

    return Response.json({
      accepted: true,
      adapter: LARK_FIRST_PARTY_ADAPTER_MANIFEST.id,
      ok: true,
    });
  });
}
