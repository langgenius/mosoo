import type { AppId, SkillId } from "@mosoo/id";
import type { Hono } from "hono";

import { getViewerFromRequest } from "../../../modules/auth/application/viewer-auth.service";
import { inspectSkillInput } from "../../../modules/skills/application/skill-package-source.service";
import {
  createSkillFromUpload,
  updateOwnedSkillPackage,
} from "../../../modules/skills/application/skill-package-write.service";
import { SkillRequestError } from "../../../modules/skills/application/skill-package.shared";
import {
  downloadSkillPackage,
  readSkillSource,
} from "../../../modules/skills/application/skill-read.service";
import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { isApiError } from "../../../platform/errors";
import { toPlatformId } from "../../../shared/platform-id";
import { toArrayBufferResponseBody } from "../../../shared/response-body";
import { platformIdRouteErrorMessage } from "./platform-id-route-error";

const MAX_SKILL_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB per PRD

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized." }, { status: 401 });
}

function errorResponse(error: unknown): Response {
  if (isApiError(error)) {
    return Response.json(
      {
        error: error.message,
      },
      { status: error.status },
    );
  }

  if (error instanceof SkillRequestError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  const platformIdErrorMessage = platformIdRouteErrorMessage(error);

  if (platformIdErrorMessage !== null) {
    return Response.json({ error: platformIdErrorMessage }, { status: 400 });
  }

  logError("skill-route.unexpected-error", createErrorLogContext(error));
  return Response.json({ error: "Skill request failed." }, { status: 500 });
}

export function registerSkillRoute(app: Hono<ApiGatewayEnvironment>) {
  app.post("/skill/inspect", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);
      if (!viewer) {
        return unauthorized();
      }

      const form = await c.req.raw.formData();
      const file = form.get("file");
      const githubUrl = form.get("githubUrl");

      if (!(file instanceof File) && typeof githubUrl !== "string") {
        throw new SkillRequestError("Either file or githubUrl must be provided.");
      }

      const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : undefined;
      const inspected = await inspectSkillInput({
        ...(bytes && file instanceof File ? { file: { bytes, name: file.name } } : {}),
        ...(typeof githubUrl === "string" && githubUrl.trim()
          ? { githubUrl: githubUrl.trim() }
          : {}),
      });
      return c.json(inspected);
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.post("/skill/package", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);
      if (!viewer) {
        return unauthorized();
      }

      const form = await c.req.raw.formData();
      const appId = form.get("appId");
      const skillId = form.get("skillId");
      const file = form.get("file");
      const githubUrl = form.get("githubUrl");

      if (typeof appId !== "string" || !appId) {
        throw new SkillRequestError("appId is required.");
      }
      if (!(file instanceof File) && typeof githubUrl !== "string") {
        throw new SkillRequestError("Either file or githubUrl must be provided.");
      }
      if (file instanceof File && file.size > MAX_SKILL_UPLOAD_BYTES) {
        throw new SkillRequestError(
          `File exceeds the limit (${Math.floor(MAX_SKILL_UPLOAD_BYTES / 1024 / 1024)} MB).`,
        );
      }

      const uploadInput = {
        ...(file instanceof File
          ? {
              file: {
                bytes: new Uint8Array(await file.arrayBuffer()),
                name: file.name,
              },
            }
          : {}),
        ...(typeof githubUrl === "string" && githubUrl.trim()
          ? { githubUrl: githubUrl.trim() }
          : {}),
      };

      if (typeof skillId === "string" && skillId) {
        return c.json(
          await updateOwnedSkillPackage(
            c.env,
            viewer,
            toPlatformId<AppId>(appId, "App ID"),
            toPlatformId<SkillId>(skillId, "Skill ID"),
            uploadInput,
          ),
        );
      }

      return c.json(
        await createSkillFromUpload(
          c.env,
          viewer,
          toPlatformId<AppId>(appId, "App ID"),
          uploadInput,
        ),
      );
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.get("/skill/:skillId/source", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);
      if (!viewer) {
        return unauthorized();
      }
      const appId = c.req.query("appId");

      if (typeof appId !== "string" || !appId) {
        throw new SkillRequestError("appId is required.");
      }
      const content = await readSkillSource(
        c.env,
        viewer,
        toPlatformId<AppId>(appId, "App ID"),
        toPlatformId<SkillId>(c.req.param("skillId"), "Skill ID"),
      );
      return new Response(content, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.get("/skill/:skillId/package", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);
      if (!viewer) {
        return unauthorized();
      }
      const appId = c.req.query("appId");

      if (typeof appId !== "string" || !appId) {
        throw new SkillRequestError("appId is required.");
      }
      const { bytes, fileName } = await downloadSkillPackage(
        c.env,
        viewer,
        toPlatformId<AppId>(appId, "App ID"),
        c.req.param("skillId"),
      );
      return new Response(toArrayBufferResponseBody(bytes), {
        headers: {
          "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
          "Content-Type": "application/zip",
        },
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
