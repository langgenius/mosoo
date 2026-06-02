import type {
  CreateOrganizationServiceTokenRequest,
  CreatePersonalAccessTokenRequest,
} from "@mosoo/contracts/auth";
import { parsePlatformId, parsePlatformIdList } from "@mosoo/id";
import type {
  AgentId,
  OrganizationId,
  OrganizationServiceTokenId,
  PersonalAccessTokenId,
} from "@mosoo/id";
import type { Hono } from "hono";

import {
  createOrganizationServiceToken,
  listOrganizationServiceTokens,
  revokeOrganizationServiceToken,
} from "../../../modules/auth/application/organization-service-token.service";
import {
  createPersonalAccessToken,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from "../../../modules/auth/application/personal-access-token.service";
import { getViewerFromRequest } from "../../../modules/auth/application/viewer-auth.service";
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

function parseRequestPlatformIdList(values: readonly unknown[], label: string) {
  try {
    return parsePlatformIdList(values, label);
  } catch {
    throw validationError(`${label} must contain valid ULIDs.`);
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

async function readCreateOrganizationServiceTokenRequest(
  request: Request,
): Promise<CreateOrganizationServiceTokenRequest | null> {
  const body = await request.json().catch(() => {
    throw validationError("Request body must be valid JSON.");
  });

  if (
    typeof body !== "object" ||
    body === null ||
    !("label" in body) ||
    typeof body.label !== "string" ||
    !("organizationId" in body) ||
    typeof body.organizationId !== "string" ||
    !("allowedAgentIds" in body) ||
    !Array.isArray(body.allowedAgentIds) ||
    body.allowedAgentIds.some((agentId) => typeof agentId !== "string")
  ) {
    return null;
  }

  const input = body as Record<string, unknown>;
  const allowedAgentIds = parseRequestPlatformIdList(
    input["allowedAgentIds"] as readonly unknown[],
    "Allowed Agent IDs",
  ) as AgentId[];
  const organizationId = parseRequestPlatformId(
    input["organizationId"],
    "Organization ID",
  ) as OrganizationId;

  return {
    allowAttribution: input["allowAttribution"] === true,
    allowedAgentIds,
    label: input["label"] as string,
    organizationId,
  };
}

export function registerAccessTokenRoute(app: Hono<ApiGatewayEnvironment>) {
  app.get("/access-tokens", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);
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
      const viewer = await getViewerFromRequest(c.env, c.req.raw);
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
      const viewer = await getViewerFromRequest(c.env, c.req.raw);
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

  app.get("/organization-service-tokens", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);
      if (!viewer) {
        return unauthorized();
      }

      const organizationId = c.req.query("organizationId");
      if (!organizationId) {
        return invalidRequest("Organization id is required.");
      }

      const parsedOrganizationId = parseRequestPlatformId(
        organizationId,
        "Organization ID",
      ) as OrganizationId;

      return c.json(await listOrganizationServiceTokens(c.env.DB, viewer, parsedOrganizationId));
    } catch (error) {
      return tokenError(error);
    }
  });

  app.post("/organization-service-tokens", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);
      if (!viewer) {
        return unauthorized();
      }

      const body = await readCreateOrganizationServiceTokenRequest(c.req.raw);
      if (!body) {
        return invalidRequest(
          "Service token label, organization, and selected Agents are required.",
        );
      }

      return c.json(await createOrganizationServiceToken(c.env.DB, viewer, body), 201);
    } catch (error) {
      return tokenError(error);
    }
  });

  app.delete("/organization-service-tokens/:tokenId", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);
      if (!viewer) {
        return unauthorized();
      }

      const tokenId = parseRequestPlatformId(
        c.req.param("tokenId"),
        "Organization service token ID",
      ) as OrganizationServiceTokenId;

      await revokeOrganizationServiceToken(c.env.DB, viewer, tokenId);
      return c.json({ ok: true });
    } catch (error) {
      return tokenError(error);
    }
  });
}
