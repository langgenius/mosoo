import { sessionRunsTable } from "@mosoo/db";
import type { SessionId, SessionRunId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";
import type { Hono } from "hono";

import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { toPlatformId } from "../../../shared/platform-id";
import { matchesInternalRouteSecret } from "./internal-route-auth";
import { platformIdRouteErrorResponse } from "./platform-id-route-error";

const STATUS_CANARY_AUTH_HEADER = "x-status-canary-auth";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusCanarySecretFromEnv(env: { MOSOO_STATUS_CANARY_SECRET?: string }): string | null {
  return env.MOSOO_STATUS_CANARY_SECRET?.trim() || null;
}

function invalidRequest(error: string): Response {
  return Response.json({ error, ok: false }, { status: 400 });
}

export function registerStatusCanaryInternalRoute(app: Hono<ApiGatewayEnvironment>) {
  app.post("/v1/internal/status-canary/driver-reuse", async (c) => {
    const configured = statusCanarySecretFromEnv(c.env);

    if (configured === null) {
      return Response.json({ error: "Not Found", ok: false }, { status: 404 });
    }

    if (!(await matchesInternalRouteSecret(c.req.header(STATUS_CANARY_AUTH_HEADER), configured))) {
      return Response.json({ error: "status canary auth required", ok: false }, { status: 401 });
    }

    const body: unknown = await c.req.json().catch(() => null);

    if (
      !isRecord(body) ||
      typeof body["threadId"] !== "string" ||
      !Array.isArray(body["runIds"]) ||
      body["runIds"].length !== 2 ||
      body["runIds"].some((runId) => typeof runId !== "string")
    ) {
      return invalidRequest("threadId and exactly two runIds are required.");
    }

    let threadId: SessionId;
    let runIds: [SessionRunId, SessionRunId];

    try {
      threadId = toPlatformId<SessionId>(body["threadId"], "Thread ID");
      runIds = [
        toPlatformId<SessionRunId>(body["runIds"][0] as string, "First run ID"),
        toPlatformId<SessionRunId>(body["runIds"][1] as string, "Follow-up run ID"),
      ];
    } catch (error) {
      const response = platformIdRouteErrorResponse(error, (message) => ({
        error: message,
        ok: false,
      }));

      if (response !== null) {
        return response;
      }
      throw error;
    }

    if (runIds[0] === runIds[1]) {
      return invalidRequest("runIds must be distinct.");
    }

    const rows = await getAppDatabase(c.env.DB)
      .select({
        driverInstanceId: sessionRunsTable.driverInstanceId,
        id: sessionRunsTable.id,
      })
      .from(sessionRunsTable)
      .where(and(eq(sessionRunsTable.sessionId, threadId), inArray(sessionRunsTable.id, runIds)))
      .all();
    const driverByRun = new Map(rows.map((row) => [row.id, row.driverInstanceId]));
    const drivers = runIds.map((runId) => driverByRun.get(runId) ?? null);

    if (drivers.some((driver) => driver === null)) {
      return Response.json(
        { error: "Canary runs are not ready for comparison.", ok: false },
        { status: 409 },
      );
    }

    return c.json({
      ok: true,
      sameDriver: drivers[0] === drivers[1],
    });
  });
}
