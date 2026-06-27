import type {
  CliOAuthDeviceConfirmRequest,
  CliOAuthDeviceStartRequest,
  CliOAuthDeviceTokenRequest,
} from "@mosoo/contracts/auth";
import { Hono } from "hono";

import {
  CliOAuthDeviceError,
  confirmCliOAuthDeviceFlow,
  pollCliOAuthDeviceToken,
  startCliOAuthDeviceFlow,
} from "../../../modules/auth/application/cli-oauth-device.service";
import { getViewerFromRequest } from "../../../modules/auth/application/viewer-auth.service";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";

function isAuthConfigured(bindings: Pick<ApiGatewayEnvironment["Bindings"], "BETTER_AUTH_SECRET">) {
  return Boolean(bindings.BETTER_AUTH_SECRET?.trim());
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonRecord(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!isJsonRecord(body)) {
    throw new CliOAuthDeviceError(400, "invalid_request", "JSON object body is required.");
  }
  return body;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = readOptionalString(record, key);
  if (value === undefined) {
    throw new CliOAuthDeviceError(400, "invalid_request", `${key} is required.`);
  }
  return value;
}

function cliOAuthError(error: unknown): Response {
  if (error instanceof CliOAuthDeviceError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.status },
    );
  }
  throw error;
}

export function registerAuthRoute(app: Hono<ApiGatewayEnvironment>) {
  const auth = new Hono<ApiGatewayEnvironment>();

  auth.post("/cli/start", async (c) => {
    try {
      const body = await readJsonRecord(c.req.raw);
      const request: CliOAuthDeviceStartRequest = {};
      const hostname = readOptionalString(body, "hostname");
      const provider = readOptionalString(body, "provider");
      if (hostname !== undefined) {
        request.hostname = hostname;
      }
      if (provider !== undefined) {
        request.provider = provider;
      }
      return c.json(
        await startCliOAuthDeviceFlow(c.env.DB, { ...request, webOrigin: c.env.WEB_ORIGIN }),
      );
    } catch (error) {
      return cliOAuthError(error);
    }
  });

  auth.post("/cli/token", async (c) => {
    try {
      const body = await readJsonRecord(c.req.raw);
      const request: CliOAuthDeviceTokenRequest = {
        device_code: readRequiredString(body, "device_code"),
      };
      return c.json(await pollCliOAuthDeviceToken(c.env.DB, request));
    } catch (error) {
      return cliOAuthError(error);
    }
  });

  auth.post("/cli/confirm", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);
      if (!viewer) {
        return Response.json({ error: "Unauthorized." }, { status: 401 });
      }

      const body = await readJsonRecord(c.req.raw);
      const request: CliOAuthDeviceConfirmRequest = {
        user_code: readRequiredString(body, "user_code"),
      };
      return c.json(await confirmCliOAuthDeviceFlow(c.env.DB, viewer, request));
    } catch (error) {
      return cliOAuthError(error);
    }
  });

  auth.on(["GET", "POST"], "/*", async (c) => {
    if (!isAuthConfigured(c.env)) {
      return c.json(
        {
          error: "Auth is not configured.",
        },
        503,
      );
    }

    const { getBetterAuth } =
      await import("../../../modules/auth/application/auth-session.service");

    return getBetterAuth(c.env).handler(c.req.raw);
  });

  app.route("/auth", auth);
}
