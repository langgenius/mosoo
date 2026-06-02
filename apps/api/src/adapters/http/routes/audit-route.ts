import type { OrganizationId } from "@mosoo/id";
import type { Hono } from "hono";

import { exportAuditEventsCsv } from "../../../modules/audit/application/audit-export.service";
import { isAuditOutcome } from "../../../modules/audit/domain/audit-vocabulary";
import type { AuditOutcome } from "../../../modules/audit/domain/audit-vocabulary";
import { getViewerFromRequest } from "../../../modules/auth/application/viewer-auth.service";
import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { isApiError } from "../../../platform/errors";
import { toPlatformId } from "../../../shared/platform-id";
import { platformIdRouteErrorMessage } from "./platform-id-route-error";

function readAuditContext(request: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

  return {
    ipAddress: request.headers.get("cf-connecting-ip")?.trim() ?? forwardedFor ?? null,
    userAgent: request.headers.get("user-agent")?.trim() ?? null,
  };
}

function parseOutcome(value: string | null): AuditOutcome | null {
  return value !== null && isAuditOutcome(value) ? value : null;
}

function parseStartMs(value: string | null): number | null {
  if (value === null || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function auditRouteError(error: unknown): Response {
  if (isApiError(error)) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  const platformIdErrorMessage = platformIdRouteErrorMessage(error);

  if (platformIdErrorMessage !== null) {
    return Response.json({ error: platformIdErrorMessage }, { status: 400 });
  }

  logError("audit-route.export.failed", createErrorLogContext(error));
  return Response.json({ error: "Audit export failed." }, { status: 500 });
}

export function registerAuditRoute(app: Hono<ApiGatewayEnvironment>) {
  app.get("/audit/export", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);
      if (!viewer) {
        return Response.json({ error: "Unauthorized." }, { status: 401 });
      }

      const url = new URL(c.req.url);
      const organizationId = url.searchParams.get("organizationId");

      if (!organizationId) {
        return Response.json({ error: "organizationId is required." }, { status: 400 });
      }

      const { csv, filename } = await exportAuditEventsCsv(
        c.env.DB,
        { ...viewer, auditContext: readAuditContext(c.req.raw) },
        {
          organizationId: toPlatformId<OrganizationId>(organizationId, "Organization ID"),
          outcome: parseOutcome(url.searchParams.get("outcome")),
          q: url.searchParams.get("q"),
          startMs: parseStartMs(url.searchParams.get("startMs")),
        },
      );

      return new Response(csv, {
        headers: {
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Type": "text/csv; charset=utf-8",
        },
      });
    } catch (error) {
      return auditRouteError(error);
    }
  });
}
