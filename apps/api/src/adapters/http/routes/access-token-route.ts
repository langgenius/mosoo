import type { CreatePersonalAccessTokenRequest } from "@mosoo/contracts/auth";
import { parsePlatformId } from "@mosoo/id";
import type { PersonalAccessTokenId } from "@mosoo/id";
import type { Hono } from "hono";

import {
  createPersonalAccessToken,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from "../../../modules/auth/application/personal-access-token.service";
import { getAuthenticatedViewerFromRequest } from "../../../modules/auth/application/viewer-auth.service";
import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import {
  toApiErrorResponseDetails,
  unauthorizedError,
  validationError,
} from "../../../platform/errors";

function unauthorized(): Response {
  return tokenError(unauthorizedError());
}

function invalidRequest(message: string): Response {
  return tokenError(validationError(message));
}

function tokenError(error: unknown): Response {
  const details = toApiErrorResponseDetails(error, {
    message: "Access token request failed.",
  });

  if (details.status >= 500) {
    logError("access-token-route.failed", createErrorLogContext(error));
  }

  return Response.json({ error: details.message }, { status: details.status });
}

function parseRequestPlatformId(value: unknown, label: string) {
  try {
    return parsePlatformId(value, label);
  } catch {
    throw validationError(`${label} must be a valid ULID.`);
  }
}

async function readCreatePersonalAccessTokenRequest(
  request: Request,
): Promise<CreatePersonalAccessTokenRequest | null> {
  const body = await request.json().catch(() => {
    throw validationError("Request body must be valid JSON.");
  });

  if (
    typeof body !== "object" ||
    body === null ||
    !("label" in body) ||
    typeof body.label !== "string"
  ) {
    return null;
  }

  return {
    label: body.label,
  };
}

export function registerAccessTokenRoute(app: Hono<ApiGatewayEnvironment>) {
  app.get("/access-tokens", async (c) => {
    try {
      const viewer = await getAuthenticatedViewerFromRequest(c.env, c.req.raw);
      if (!viewer) {
        return unauthorized();
      }

      return c.json(await listPersonalAccessTokens(c.env.DB, viewer));
    } catch (error) {
      return tokenError(error);
    }
  });

  app.post("/access-tokens", async (c) => {
    try {
      const viewer = await getAuthenticatedViewerFromRequest(c.env, c.req.raw);
      if (!viewer) {
        return unauthorized();
      }

      const body = await readCreatePersonalAccessTokenRequest(c.req.raw);
      if (!body) {
        return invalidRequest("Token label is required.");
      }

      return c.json(await createPersonalAccessToken(c.env.DB, viewer, body), 201);
    } catch (error) {
      return tokenError(error);
    }
  });

  app.delete("/access-tokens/:tokenId", async (c) => {
    try {
      const viewer = await getAuthenticatedViewerFromRequest(c.env, c.req.raw);
      if (!viewer) {
        return unauthorized();
      }

      const tokenId = parseRequestPlatformId(
        c.req.param("tokenId"),
        "Personal access token ID",
      ) as PersonalAccessTokenId;

      await revokePersonalAccessToken(c.env.DB, viewer, tokenId);
      return c.json({ ok: true });
    } catch (error) {
      return tokenError(error);
    }
  });
}
