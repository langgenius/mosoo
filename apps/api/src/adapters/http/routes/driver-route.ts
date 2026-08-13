import type { PresetModelProtocol } from "@mosoo/contracts/models";
import type {
  CredentialId,
  DriverInstanceId,
  McpServerId,
  SkillSnapshotId,
  VendorCredentialId,
} from "@mosoo/id";
import type { Context } from "hono";
import { Hono } from "hono";

import {
  invalidateRuntimeCredential,
  refreshRuntimeCredential,
} from "../../../modules/mcp/application/mcp-runtime.service";
import type { RuntimeActionTokenPayload } from "../../../modules/runtime/application/runtime-driver-access.service";
import {
  cleanupDriverInstances,
  requireRuntimeDriverInstanceGrant,
  verifyRuntimeActionToken,
} from "../../../modules/runtime/application/runtime-driver-access.service";
import type { RuntimeLlmProxyTarget } from "../../../modules/runtime/application/runtime-llm-proxy.service";
import {
  RuntimeLlmProxyError,
  requireActiveRuntimeLlmProxyDriver,
  resolveRuntimeLlmProxyTarget,
} from "../../../modules/runtime/application/runtime-llm-proxy.service";
import {
  RUNTIME_MCP_DELEGATION_HEADER,
  RUNTIME_MCP_TOOL_CALL_ID_HEADER,
  readRuntimeMcpToolCallId,
} from "../../../modules/runtime/application/runtime-mcp-delegation";
import {
  createRuntimeMcpProxyError,
  runtimeMcpProxyErrorBody,
  toRuntimeMcpProxyPublicErrorDetails,
} from "../../../modules/runtime/application/runtime-mcp-proxy-errors";
import { resolveRuntimeMcpProxyTarget } from "../../../modules/runtime/application/runtime-mcp-proxy.service";
import { getRuntimeDriverRoutePrefix } from "../../../modules/runtime/domain/runtime-driver-routes";
import { upgradeDriverInstanceSocket } from "../../../modules/runtime/infrastructure/driver-instance/client";
import { getDriverInstanceRecord } from "../../../modules/runtime/infrastructure/driver-instance/driver-instance-record.repository";
import { readSkillPackageBytesFromSnapshot } from "../../../modules/skills/application/skill-package-snapshot.service";
import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { toArrayBuffer } from "../../../shared/bytes";
import { toPlatformId } from "../../../shared/platform-id";
import { isTruthy } from "../../../shared/truthiness";
import { platformIdRouteErrorResponse } from "./platform-id-route-error";
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

// Headers LLM SDKs use to carry the proxy grant. They are stripped before the
// request goes upstream and replaced with the vendor's real credential.
const LLM_PROXY_GRANT_HEADERS = new Set(["authorization", "x-api-key", "x-goog-api-key"]);
const LLM_PROXY_PATH_MARKER = "/llm/proxy/";
const LLM_PROXY_UNSAFE_PATH_ENCODING = /%(?:25|2f|5c)/iu;
const OPENAI_IMAGE_API_PATHS = new Set(["/images/edits", "/images/generations"]);

async function requireDriverActionGrant(c: Context<ApiGatewayEnvironment>) {
  const grant = c.req.query("grant");

  if (!isTruthy(grant)) {
    throw new Error("Runtime action grant is required.");
  }

  return verifyRuntimeActionToken(c.env, grant);
}

async function requireDriverAuthorizationGrant(c: Context<ApiGatewayEnvironment>) {
  const authorization = c.req.header("Authorization");
  const [scheme, grant] = authorization?.split(/\s+/, 2) ?? [];

  if (scheme?.toLowerCase() !== "bearer" || !isTruthy(grant)) {
    throw new Error("Runtime proxy authorization grant is required.");
  }

  return verifyRuntimeActionToken(c.env, grant);
}

export function copyProxyRequestHeaders(
  headers: Headers,
  upstreamAccessToken: string,
  delegationToken?: string | null,
): Headers {
  const nextHeaders = new Headers();

  for (const [key, value] of headers) {
    if (
      !HOP_BY_HOP_HEADERS.has(key.toLowerCase()) &&
      key.toLowerCase() !== RUNTIME_MCP_DELEGATION_HEADER.toLowerCase() &&
      key.toLowerCase() !== RUNTIME_MCP_TOOL_CALL_ID_HEADER.toLowerCase()
    ) {
      nextHeaders.set(key, value);
    }
  }

  nextHeaders.set("Authorization", `Bearer ${upstreamAccessToken}`);
  if (delegationToken) nextHeaders.set(RUNTIME_MCP_DELEGATION_HEADER, delegationToken);
  return nextHeaders;
}

function copyProxyResponseHeaders(headers: Headers): Headers {
  const nextHeaders = new Headers();

  for (const [key, value] of headers) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      nextHeaders.set(key, value);
    }
  }

  return nextHeaders;
}

function toUpstreamProxyUrl(request: Request, upstreamUrl: string): string {
  const target = new URL(upstreamUrl);
  const incoming = new URL(request.url);

  for (const [key, value] of incoming.searchParams) {
    if (key !== "grant") {
      target.searchParams.append(key, value);
    }
  }

  return target.toString();
}

function driverPlatformIdErrorResponse(error: unknown): Response | null {
  return platformIdRouteErrorResponse(error, (message) => ({ error: message }));
}

async function isStartupSkillDownloadGrant(
  c: Context<ApiGatewayEnvironment>,
  grant: RuntimeActionTokenPayload & { action: "skill_snapshot" },
): Promise<boolean> {
  const driver = await getDriverInstanceRecord(c.env.DB, grant.driverInstanceId);
  return driver?.status === "provisioning" || driver?.status === "connecting";
}

async function requireSkillSnapshotDownloadGrant(
  c: Context<ApiGatewayEnvironment>,
  input: {
    grant: RuntimeActionTokenPayload & { action: "skill_snapshot" };
    snapshotId: SkillSnapshotId;
  },
): Promise<void> {
  try {
    await requireRuntimeDriverInstanceGrant(c.env.DB, {
      driverInstanceId: input.grant.driverInstanceId,
      requireAction: "skill_snapshot",
      snapshotId: input.snapshotId,
    });
    return;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "Snapshot is not available for this driver instance."
    ) {
      throw error;
    }

    // Cold drivers materialize skills during boot, before the run lease is linked
    // to session_run.driver_instance_id. The signed action token already binds
    // this request to the driver instance and snapshot; this fallback only spans
    // that provisioning window.
    if (await isStartupSkillDownloadGrant(c, input.grant)) {
      return;
    }
    throw error;
  }
}

function readLlmProxyGrantToken(headers: Headers): string | null {
  const apiKey = headers.get("x-api-key")?.trim();

  if (isTruthy(apiKey)) {
    return apiKey;
  }

  const googApiKey = headers.get("x-goog-api-key")?.trim();

  if (isTruthy(googApiKey)) {
    return googApiKey;
  }

  const authorization = headers.get("Authorization");
  const [scheme, grant] = authorization?.split(/\s+/, 2) ?? [];

  if (scheme?.toLowerCase() === "bearer" && isTruthy(grant)) {
    return grant;
  }

  return null;
}

function extractLlmProxySubPath(pathname: string): string | null {
  const markerIndex = pathname.indexOf(LLM_PROXY_PATH_MARKER);

  if (markerIndex === -1) {
    return null;
  }

  const rest = pathname.slice(markerIndex + LLM_PROXY_PATH_MARKER.length);
  const slashIndex = rest.indexOf("/");
  const subPath = slashIndex === -1 ? "" : rest.slice(slashIndex);

  if (subPath.includes("\\") || LLM_PROXY_UNSAFE_PATH_ENCODING.test(subPath)) {
    return null;
  }

  for (const segment of subPath.split("/")) {
    let decoded: string;

    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }

    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("%")
    ) {
      return null;
    }
  }

  return subPath;
}

function resolveGrantedLlmProxyModelId(
  method: string,
  subPath: string,
  modelId: string,
  modelProtocol: PresetModelProtocol,
  imageModelId?: string,
): string | null {
  const decodedPath = decodeURIComponent(subPath);

  if (decodedPath !== subPath) {
    return null;
  }

  switch (modelProtocol) {
    case "anthropic-messages":
      return method === "POST" &&
        ["/messages", "/v1/messages", "/v1/messages/count_tokens"].includes(decodedPath)
        ? modelId
        : null;
    case "google-gemini": {
      const modelPath = modelId.includes("/") ? modelId : `models/${modelId}`;
      const modelPathIsCanonical = modelPath
        .split("/")
        .every(
          (segment) =>
            segment !== "" &&
            segment !== "." &&
            segment !== ".." &&
            /^[A-Za-z0-9._-]+$/u.test(segment),
        );

      return method === "POST" &&
        modelPathIsCanonical &&
        [`/${modelPath}:generateContent`, `/${modelPath}:streamGenerateContent`].includes(
          decodedPath,
        )
        ? modelId
        : null;
    }
    case "openai-chat-completions":
      return method === "POST" && decodedPath === "/chat/completions" ? modelId : null;
    case "openai-responses": {
      if (method !== "POST") {
        return null;
      }

      if (["/responses", "/responses/compact"].includes(decodedPath)) {
        return modelId;
      }

      return imageModelId !== undefined && OPENAI_IMAGE_API_PATHS.has(decodedPath)
        ? imageModelId
        : null;
    }
  }
}

function isOpenAiResponsesWebSocketProbe(
  request: Request,
  subPath: string,
  modelProtocol: PresetModelProtocol,
): boolean {
  return (
    modelProtocol === "openai-responses" &&
    request.method === "GET" &&
    subPath === "/responses" &&
    request.headers.get("Upgrade")?.toLowerCase() === "websocket"
  );
}

async function readGrantedLlmProxyRequestBody(
  request: Request,
  modelId: string,
  modelProtocol: PresetModelProtocol,
  subPath: string,
): Promise<{ body: BodyInit | null } | null> {
  if (modelProtocol === "google-gemini") {
    // Gemini binds the model in the exact admitted request path.
    return { body: request.body };
  }

  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();

  if (
    modelProtocol === "openai-responses" &&
    subPath === "/images/edits" &&
    mediaType === "multipart/form-data"
  ) {
    try {
      const models = (await request.clone().formData()).getAll("model");
      return models.length === 1 && models[0] === modelId ? { body: request.body } : null;
    } catch {
      return null;
    }
  }

  try {
    const body: unknown = await request.json();

    if (
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      "model" in body &&
      body.model === modelId
    ) {
      // Re-serialize the parsed body so duplicate JSON keys cannot make the
      // proxy and the upstream disagree about which model was requested.
      return { body: JSON.stringify(body) };
    }
  } catch {
    // Invalid JSON is outside the model inference capability.
  }

  return null;
}

function toLlmProxyUpstreamUrl(request: Request, upstreamBaseUrl: string, subPath: string): string {
  const base = new URL(upstreamBaseUrl);
  const basePath = base.pathname === "/" ? "" : base.pathname.replace(/\/+$/u, "");
  const expectedPath = `${basePath}${subPath}`;

  if (
    base.hash !== "" ||
    basePath.includes("\\") ||
    LLM_PROXY_UNSAFE_PATH_ENCODING.test(basePath)
  ) {
    throw new RuntimeLlmProxyError("LLM proxy upstream base URL is invalid.", 502);
  }

  const target = new URL(`${base.origin}${expectedPath}`);

  for (const [key, value] of base.searchParams) {
    target.searchParams.append(key, value);
  }

  for (const [key, value] of new URL(request.url).searchParams) {
    target.searchParams.append(key, value);
  }

  if (target.origin !== base.origin || target.pathname !== expectedPath) {
    throw new RuntimeLlmProxyError("LLM proxy path is invalid.", 400);
  }

  return target.toString();
}

function buildLlmProxyUpstreamHeaders(incoming: Headers, target: RuntimeLlmProxyTarget): Headers {
  const headers = new Headers();

  for (const [key, value] of incoming) {
    const lowered = key.toLowerCase();

    if (!HOP_BY_HOP_HEADERS.has(lowered) && !LLM_PROXY_GRANT_HEADERS.has(lowered)) {
      headers.set(key, value);
    }
  }

  const { authHeader } = target.vendor;

  if (authHeader.scheme === "bearer") {
    headers.set(authHeader.apiKeyHeader, `Bearer ${target.apiKey}`);
    return headers;
  }

  for (const [key, value] of Object.entries(authHeader.extraHeaders)) {
    // Only fill protocol headers the client did not set itself: SDKs pin
    // e.g. anthropic-version to the wire format they actually speak.
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  headers.set(authHeader.apiKeyHeader, target.apiKey);
  return headers;
}

async function proxyRuntimeLlmRequest(
  request: Request,
  subPath: string,
  target: RuntimeLlmProxyTarget,
  body: BodyInit | null,
): Promise<Response> {
  const init: RequestInit = {
    headers: buildLlmProxyUpstreamHeaders(request.headers, target),
    method: request.method,
    redirect: "manual",
    signal: request.signal,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = body;
  }

  const response = await fetch(
    toLlmProxyUpstreamUrl(request, target.upstreamBaseUrl, subPath),
    init,
  );

  return new Response(response.body, {
    headers: copyProxyResponseHeaders(response.headers),
    status: response.status,
    statusText: response.statusText,
  });
}

async function proxyRuntimeMcpRequest(
  request: Request,
  input: {
    delegationToken?: string | null;
    upstreamAccessToken: string;
    url: string;
  },
): Promise<Response> {
  const init: RequestInit = {
    headers: copyProxyRequestHeaders(
      request.headers,
      input.upstreamAccessToken,
      input.delegationToken,
    ),
    method: request.method,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const response = await fetch(toUpstreamProxyUrl(request, input.url), init);

  return new Response(response.body, {
    headers: copyProxyResponseHeaders(response.headers),
    status: response.status,
    statusText: response.statusText,
  });
}

export function registerDriverRoute(app: Hono<ApiGatewayEnvironment>) {
  const driver = new Hono<ApiGatewayEnvironment>();

  driver.get("/socket", async (c) => {
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json(
        { error: "Driver socket requires a WebSocket upgrade." },
        { status: 426 },
      );
    }

    let driverInstanceId: DriverInstanceId;

    try {
      driverInstanceId = toPlatformId<DriverInstanceId>(
        c.req.query("driverInstanceId") ?? "",
        "Driver instance ID",
      );
    } catch (error) {
      const response = driverPlatformIdErrorResponse(error);
      if (response !== null) {
        return response;
      }
      throw error;
    }

    return upgradeDriverInstanceSocket(c.env, driverInstanceId, c.req.raw);
  });

  driver.get("/skill/:snapshotId/package", async (c) => {
    await cleanupDriverInstances(c.env);

    let grant: Awaited<ReturnType<typeof requireDriverActionGrant>>;

    try {
      grant = await requireDriverActionGrant(c);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Unauthorized." },
        { status: 401 },
      );
    }

    if (grant.action !== "skill_snapshot") {
      return Response.json(
        { error: "Runtime action grant is invalid for skill download." },
        { status: 403 },
      );
    }

    let snapshotId: SkillSnapshotId;

    try {
      snapshotId = toPlatformId<SkillSnapshotId>(c.req.param("snapshotId"), "Skill snapshot ID");
    } catch (error) {
      const response = driverPlatformIdErrorResponse(error);
      if (response !== null) {
        return response;
      }
      throw error;
    }

    if (grant.resourceId !== snapshotId) {
      return Response.json(
        { error: "Runtime action grant does not match this skill snapshot." },
        { status: 403 },
      );
    }

    try {
      await requireSkillSnapshotDownloadGrant(c, {
        grant,
        snapshotId,
      });
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Snapshot is not available for this driver instance.",
        },
        { status: 403 },
      );
    }

    const bytes = await readSkillPackageBytesFromSnapshot(c.env, snapshotId);

    return new Response(toArrayBuffer(bytes), {
      headers: {
        "Content-Type": "application/zip",
      },
    });
  });

  driver.post("/mcp/credential/:credentialId/refresh", async (c) => {
    await cleanupDriverInstances(c.env);

    try {
      const grant = await requireDriverActionGrant(c);
      const credentialId = toPlatformId<CredentialId>(c.req.param("credentialId"), "Credential ID");

      if (grant.action !== "credential_refresh") {
        return Response.json(
          { error: "Runtime action grant is invalid for credential refresh." },
          { status: 403 },
        );
      }

      if (grant.resourceId !== credentialId) {
        return Response.json(
          { error: "Runtime action grant does not match this credential." },
          { status: 403 },
        );
      }

      await requireRuntimeDriverInstanceGrant(c.env.DB, {
        credentialId,
        driverInstanceId: toPlatformId<DriverInstanceId>(
          grant.driverInstanceId,
          "Driver instance ID",
        ),
        requireAction: "refresh",
      });
      const refreshed = await refreshRuntimeCredential(c.env, credentialId);
      return c.json(refreshed);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Credential refresh failed." },
        { status: 400 },
      );
    }
  });

  driver.post("/mcp/credential/:credentialId/invalidate", async (c) => {
    await cleanupDriverInstances(c.env);

    try {
      const grant = await requireDriverActionGrant(c);
      const credentialId = toPlatformId<CredentialId>(c.req.param("credentialId"), "Credential ID");

      if (grant.action !== "credential_invalidate") {
        return Response.json(
          { error: "Runtime action grant is invalid for credential invalidation." },
          { status: 403 },
        );
      }

      if (grant.resourceId !== credentialId) {
        return Response.json(
          { error: "Runtime action grant does not match this credential." },
          { status: 403 },
        );
      }

      await requireRuntimeDriverInstanceGrant(c.env.DB, {
        credentialId,
        driverInstanceId: toPlatformId<DriverInstanceId>(
          grant.driverInstanceId,
          "Driver instance ID",
        ),
        requireAction: "invalidate",
      });
      await invalidateRuntimeCredential(c.env.DB, credentialId);
      return c.json({ ok: true as const });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Credential invalidate failed." },
        { status: 400 },
      );
    }
  });

  driver.all("/llm/proxy/:credentialId/*", async (c) => {
    const grantToken = readLlmProxyGrantToken(c.req.raw.headers);

    if (grantToken === null) {
      return Response.json(
        { error: "LLM proxy authorization grant is required." },
        { status: 401 },
      );
    }

    let grant: RuntimeActionTokenPayload;

    try {
      grant = await verifyRuntimeActionToken(c.env, grantToken);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Unauthorized." },
        { status: 401 },
      );
    }

    if (grant.action !== "llm_proxy") {
      return Response.json(
        { error: "Runtime action grant is invalid for LLM proxy." },
        { status: 403 },
      );
    }

    let credentialId: VendorCredentialId;

    try {
      credentialId = toPlatformId<VendorCredentialId>(
        c.req.param("credentialId"),
        "Vendor credential ID",
      );
    } catch (error) {
      const response = driverPlatformIdErrorResponse(error);
      if (response !== null) {
        return response;
      }
      throw error;
    }

    if (grant.resourceId !== credentialId) {
      return Response.json(
        { error: "Runtime action grant does not match this credential." },
        { status: 403 },
      );
    }

    const subPath = extractLlmProxySubPath(new URL(c.req.url).pathname);

    if (subPath === null) {
      return Response.json({ error: "LLM proxy path is invalid." }, { status: 400 });
    }

    try {
      await requireActiveRuntimeLlmProxyDriver(c.env, {
        driverGeneration: grant.driverGeneration,
        driverInstanceId: grant.driverInstanceId,
      });
    } catch (error) {
      if (error instanceof RuntimeLlmProxyError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    if (isOpenAiResponsesWebSocketProbe(c.req.raw, subPath, grant.modelProtocol)) {
      // Codex falls back to HTTP Responses only on 426. Never turn this
      // WebSocket handshake into a credential-bearing HTTP upstream request.
      return new Response(null, {
        headers: { Upgrade: "websocket" },
        status: 426,
      });
    }

    const grantedModelId = resolveGrantedLlmProxyModelId(
      c.req.method,
      subPath,
      grant.modelId,
      grant.modelProtocol,
      grant.imageModelId,
    );

    if (grantedModelId === null) {
      return Response.json(
        { error: "LLM proxy request is outside the granted model capability." },
        { status: 403 },
      );
    }

    const grantedRequestBody = await readGrantedLlmProxyRequestBody(
      c.req.raw,
      grantedModelId,
      grant.modelProtocol,
      subPath,
    );

    if (grantedRequestBody === null) {
      return Response.json(
        { error: "LLM proxy request is outside the granted model capability." },
        { status: 403 },
      );
    }

    let target: RuntimeLlmProxyTarget;

    try {
      target = await resolveRuntimeLlmProxyTarget(c.env, {
        credentialId,
        appId: grant.appId,
      });
    } catch (error) {
      if (error instanceof RuntimeLlmProxyError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    try {
      return await proxyRuntimeLlmRequest(c.req.raw, subPath, target, grantedRequestBody.body);
    } catch (error) {
      if (error instanceof RuntimeLlmProxyError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      logError("runtime.llm_proxy.upstream_failed", createErrorLogContext(error));
      return Response.json({ error: "LLM proxy upstream request failed." }, { status: 502 });
    }
  });

  driver.all("/mcp/proxy/:serverId", async (c) => {
    await cleanupDriverInstances(c.env);

    let grant: Awaited<ReturnType<typeof requireDriverAuthorizationGrant>>;

    try {
      grant = await requireDriverAuthorizationGrant(c);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Unauthorized." },
        { status: 401 },
      );
    }

    let serverId: McpServerId;

    try {
      serverId = toPlatformId<McpServerId>(c.req.param("serverId"), "MCP server ID");
    } catch (error) {
      const response = driverPlatformIdErrorResponse(error);
      if (response !== null) {
        return response;
      }
      throw error;
    }

    if (grant.action !== "mcp_proxy") {
      return Response.json(
        { error: "Runtime action grant is invalid for MCP proxy." },
        { status: 403 },
      );
    }

    if (grant.resourceId !== serverId) {
      return Response.json(
        { error: "Runtime action grant does not match this MCP server." },
        { status: 403 },
      );
    }

    let target: Awaited<ReturnType<typeof resolveRuntimeMcpProxyTarget>>;
    let toolCallId: string | null;

    try {
      toolCallId = readRuntimeMcpToolCallId(c.req.raw.headers);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "MCP tool call ID header is invalid." },
        { status: 400 },
      );
    }

    try {
      target = await resolveRuntimeMcpProxyTarget(c.env, {
        driverInstanceId: toPlatformId<DriverInstanceId>(
          grant.driverInstanceId,
          "Driver instance ID",
        ),
        serverId,
        toolCallId,
      });
    } catch (error) {
      const details = toRuntimeMcpProxyPublicErrorDetails(error);
      return Response.json(runtimeMcpProxyErrorBody(details), { status: details.status });
    }

    try {
      return await proxyRuntimeMcpRequest(c.req.raw, target);
    } catch {
      const proxyError = createRuntimeMcpProxyError({
        code: "mcp_upstream_unavailable",
        message: "MCP proxy upstream request failed.",
        status: 502,
      });
      const details = toRuntimeMcpProxyPublicErrorDetails(proxyError);
      return Response.json(runtimeMcpProxyErrorBody(details), { status: details.status });
    }
  });

  app.route(getRuntimeDriverRoutePrefix(), driver);
}
