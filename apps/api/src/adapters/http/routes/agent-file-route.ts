import type { Hono } from "hono";

import { getViewerFromRequest } from "../../../modules/auth/application/viewer-auth.service";
import { downloadAgentFile } from "../../../modules/runtime/application/agent-file-browser.service";
import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { isApiError } from "../../../platform/errors";

function agentFileRouteError(error: unknown): Response {
  if (isApiError(error)) {
    return Response.json({ code: error.code, error: error.message }, { status: error.status });
  }

  logError("agent-file-route.download.failed", createErrorLogContext(error));
  return Response.json({ error: "Agent file download failed." }, { status: 500 });
}

function getAttachmentDisposition(fileName: string): string {
  const safeAsciiName = fileName.replace(/[^\u0020-\u007e]|[\r\n"]/gu, "_") || "download";
  return `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function toSingleChunkStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export function registerAgentFileRoute(app: Hono<ApiGatewayEnvironment>): void {
  app.get("/agent/:agentId/file", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);

      if (!viewer) {
        return Response.json({ error: "Unauthorized." }, { status: 401 });
      }

      const url = new URL(c.req.url);
      const path = url.searchParams.get("path");

      if (!path) {
        return Response.json({ error: "path is required." }, { status: 400 });
      }

      if (url.searchParams.get("download") !== "1") {
        return Response.json({ error: "download must be 1." }, { status: 400 });
      }

      const file = await downloadAgentFile(c.env, viewer, {
        agentId: c.req.param("agentId"),
        path,
      });

      return new Response(toSingleChunkStream(file.bytes), {
        headers: {
          "Content-Disposition": getAttachmentDisposition(file.fileName),
          "Content-Type": file.mimeType,
        },
      });
    } catch (error) {
      return agentFileRouteError(error);
    }
  });
}
