import type { CreateWorkspaceApiKeyRequest } from "@mosoo/contracts/auth";
import { parsePlatformId } from "@mosoo/id";
import type { AppId, WorkspaceApiKeyId } from "@mosoo/id";
import type { Hono } from "hono";

import { getAuthenticatedViewerFromRequest } from "../../../modules/auth/application/viewer-auth.service";
import {
  createWorkspaceApiKey,
  listWorkspaceApiKeys,
  revokeWorkspaceApiKey,
} from "../../../modules/auth/application/workspace-api-key.service";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { toApiErrorResponseDetails, validationError } from "../../../platform/errors";

function errorResponse(error: unknown): Response {
  const details = toApiErrorResponseDetails(error, {
    message: "Workspace API key request failed.",
  });
  return Response.json({ error: details.message }, { status: details.status });
}

function parseWorkspaceId(value: string): AppId {
  return parsePlatformId<AppId>(value, "Workspace ID");
}

async function readCreateRequest(request: Request): Promise<CreateWorkspaceApiKeyRequest> {
  const body: unknown = await request.json().catch(() => {
    throw validationError("Request body must be valid JSON.");
  });

  if (
    typeof body !== "object" ||
    body === null ||
    !("label" in body) ||
    typeof body.label !== "string"
  ) {
    throw validationError("API key label is required.");
  }

  return { label: body.label };
}

export function registerWorkspaceApiKeyRoute(app: Hono<ApiGatewayEnvironment>): void {
  app.get("/workspaces/:workspaceId/api-keys", async (c) => {
    try {
      const viewer = await getAuthenticatedViewerFromRequest(c.env, c.req.raw);
      if (viewer === null) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      return Response.json(
        await listWorkspaceApiKeys(c.env.DB, viewer, parseWorkspaceId(c.req.param("workspaceId"))),
      );
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.post("/workspaces/:workspaceId/api-keys", async (c) => {
    try {
      const viewer = await getAuthenticatedViewerFromRequest(c.env, c.req.raw);
      if (viewer === null) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      const body = await readCreateRequest(c.req.raw);
      return Response.json(
        await createWorkspaceApiKey(c.env.DB, viewer, {
          label: body.label,
          workspaceId: parseWorkspaceId(c.req.param("workspaceId")),
        }),
        { status: 201 },
      );
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.delete("/workspaces/:workspaceId/api-keys/:keyId", async (c) => {
    try {
      const viewer = await getAuthenticatedViewerFromRequest(c.env, c.req.raw);
      if (viewer === null) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      await revokeWorkspaceApiKey(c.env.DB, viewer, {
        keyId: parsePlatformId<WorkspaceApiKeyId>(c.req.param("keyId"), "Workspace API key ID"),
        workspaceId: parseWorkspaceId(c.req.param("workspaceId")),
      });
      return Response.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
