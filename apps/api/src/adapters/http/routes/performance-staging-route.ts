import type { Hono } from "hono";

import { isAuthorizedMosooAiDevelopmentBackdoorRequest } from "../../../modules/auth/infrastructure/mosoo-ai-development-backdoor";
import {
  captureRuntimePerformanceIdentity,
  captureRuntimePerformanceTrace,
  disconnectRuntimePerformanceViewers,
  destroyRuntimePerformanceContainer,
  inspectRuntimePerformanceCleanup,
} from "../../../modules/runtime/infrastructure/performance/runtime-performance-identity.service";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";

async function authorizePerformanceRequest(request: Request, expectedToken: string | undefined) {
  const token = expectedToken?.trim() ?? "";
  return token.length > 0 && (await isAuthorizedMosooAiDevelopmentBackdoorRequest(request, token));
}

export function registerPerformanceStagingRoute(app: Hono<ApiGatewayEnvironment>) {
  app.post("/v1/internal/performance/runtime-destroy", async (c) => {
    if (!(await authorizePerformanceRequest(c.req.raw, c.env.MOSOO_PERF_AUTH_TOKEN))) {
      return c.notFound();
    }

    const sandboxId = c.req.query("sandboxId")?.trim() ?? "";

    if (sandboxId.length === 0) {
      return c.json({ error: "sandboxId is required" }, 400);
    }

    return c.json(await destroyRuntimePerformanceContainer(c.env, { sandboxId }));
  });

  app.get("/v1/internal/performance/runtime-identity", async (c) => {
    if (!(await authorizePerformanceRequest(c.req.raw, c.env.MOSOO_PERF_AUTH_TOKEN))) {
      return c.notFound();
    }

    const runId = c.req.query("runId")?.trim() ?? "";
    const threadId = c.req.query("threadId")?.trim() ?? "";

    if (runId.length === 0 || threadId.length === 0) {
      return c.json({ error: "runId and threadId are required" }, 400);
    }

    try {
      return c.json(await captureRuntimePerformanceIdentity(c.env, { runId, threadId }));
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Runtime identity capture failed." },
        500,
      );
    }
  });

  app.get("/v1/internal/performance/runtime-trace", async (c) => {
    if (!(await authorizePerformanceRequest(c.req.raw, c.env.MOSOO_PERF_AUTH_TOKEN))) {
      return c.notFound();
    }

    const runId = c.req.query("runId")?.trim() ?? "";
    const threadId = c.req.query("threadId")?.trim() ?? "";

    if (runId.length === 0 || threadId.length === 0) {
      return c.json({ error: "runId and threadId are required" }, 400);
    }

    try {
      return c.json(await captureRuntimePerformanceTrace(c.env.DB, { runId, threadId }));
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Runtime trace capture failed." },
        500,
      );
    }
  });

  app.post("/v1/internal/performance/runtime-disconnect-viewers", async (c) => {
    if (!(await authorizePerformanceRequest(c.req.raw, c.env.MOSOO_PERF_AUTH_TOKEN))) {
      return c.notFound();
    }

    const threadId = c.req.query("threadId")?.trim() ?? "";

    if (threadId.length === 0) {
      return c.json({ error: "threadId is required" }, 400);
    }

    return c.json(await disconnectRuntimePerformanceViewers(c.env, { threadId }));
  });

  app.get("/v1/internal/performance/runtime-cleanup", async (c) => {
    if (!(await authorizePerformanceRequest(c.req.raw, c.env.MOSOO_PERF_AUTH_TOKEN))) {
      return c.notFound();
    }

    const driverInstanceId = c.req.query("driverInstanceId")?.trim() ?? "";
    const sandboxId = c.req.query("sandboxId")?.trim() ?? "";
    const threadId = c.req.query("threadId")?.trim() ?? "";

    if (driverInstanceId.length === 0 || sandboxId.length === 0 || threadId.length === 0) {
      return c.json({ error: "driverInstanceId, sandboxId, and threadId are required" }, 400);
    }

    return c.json(
      await inspectRuntimePerformanceCleanup(c.env.DB, {
        driverInstanceId,
        sandboxId,
        threadId,
      }),
    );
  });
}
