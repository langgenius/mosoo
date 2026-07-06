import type { CredentialId, DriverInstanceId, McpServerId, SkillSnapshotId } from "@mosoo/id";
import type { Context } from "hono";
import { Hono } from "hono";

import type { RuntimeActionTokenPayload } from "../../../modules/runtime/application/runtime-driver-access.service";
import {
  cleanupDriverInstances,
  requireRuntimeDriverInstanceGrant,
  verifyRuntimeActionToken,
} from "../../../modules/runtime/application/runtime-driver-access.service";
import { getRuntimeDriverRoutePrefix } from "../../../modules/runtime/application/runtime-driver-routes.service";
import {
  invalidateRuntimeCredential,
  refreshRuntimeCredential,
} from "../../../modules/runtime/application/runtime-mcp-credential.service";
import {
  createRuntimeMcpProxyError,
  runtimeMcpProxyErrorBody,
  toRuntimeMcpProxyPublicErrorDetails,
} from "../../../modules/runtime/application/runtime-mcp-proxy-errors";
import { resolveRuntimeMcpProxyTarget } from "../../../modules/runtime/application/runtime-mcp-proxy.service";
import { upgradeDriverInstanceSocket } from "../../../modules/runtime/infrastructure/driver-instance/client";
import { getDriverInstanceRecord } from "../../../modules/runtime/infrastructure/driver-instance/driver-instance-record.repository";
import { readSkillPackageBytesFromSnapshot } from "../../../modules/skills/application/skill-package-snapshot.service";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { toPlatformId } from "../../../shared/platform-id";
import { toArrayBufferResponseBody } from "../../../shared/response-body";
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

function copyProxyRequestHeaders(headers: Headers, upstreamAccessToken: string): Headers {
  const nextHeaders = new Headers();

  for (const [key, value] of headers) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      nextHeaders.set(key, value);
    }
  }

  nextHeaders.set("Authorization", `Bearer ${upstreamAccessToken}`);
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

async function proxyRuntimeMcpRequest(
  request: Request,
  input: {
    upstreamAccessToken: string;
    url: string;
  },
): Promise<Response> {
  const init: RequestInit = {
    headers: copyProxyRequestHeaders(request.headers, input.upstreamAccessToken),
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

    return new Response(toArrayBufferResponseBody(bytes), {
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

    try {
      target = await resolveRuntimeMcpProxyTarget(c.env, {
        driverInstanceId: toPlatformId<DriverInstanceId>(
          grant.driverInstanceId,
          "Driver instance ID",
        ),
        serverId,
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
