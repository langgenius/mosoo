import type {
  CompleteFileUploadRequest,
  CreateFileUploadRequest,
  FileErrorResponse,
  UpdateFileRequest,
} from "@mosoo/contracts/file";
import type {
  AcquireSpaceFileLockRequest,
  ReleaseSpaceFileLockRequest,
} from "@mosoo/contracts/space";
import type { FileId, AppId, SpaceId } from "@mosoo/id";
import type { Hono } from "hono";

import { getViewerFromRequest } from "../../../modules/auth/application/viewer-auth.service";
import {
  FileControlError,
  abortFileUpload,
  acquireSpaceFileLock,
  completeFileUpload,
  createFileErrorResponse,
  createFileUpload,
  createUnexpectedFileError,
  deleteFileById,
  getFileUpload,
  normalizeR2Etag,
  releaseSpaceFileLock,
  streamFileContent,
  updateSpaceFile,
  uploadFileContent,
  uploadFilePart,
} from "../../../modules/files/application/file-http.service";
import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiGatewayEnvironment } from "../../../platform/cloudflare/worker-types";
import { isApiError } from "../../../platform/errors";
import { toPlatformId } from "../../../shared/platform-id";
import { platformIdRouteErrorMessage } from "./platform-id-route-error";

function unauthorizedFileError(): FileControlError {
  return new FileControlError(401, "file_unauthorized", "Unauthorized.");
}

function toErrorResponse(error: unknown): Response {
  if (isApiError(error)) {
    return Response.json(
      {
        error: {
          code: error.status === 401 ? "file_unauthorized" : "file_forbidden",
          details: {},
          message: error.message,
          retryable: false,
          status: error.status,
        },
      } satisfies FileErrorResponse,
      {
        status: error.status,
      },
    );
  }

  const platformIdErrorMessage = platformIdRouteErrorMessage(error);

  if (platformIdErrorMessage !== null) {
    const normalized = new FileControlError(400, "file_invalid_request", platformIdErrorMessage);
    return Response.json(createFileErrorResponse(normalized), { status: normalized.status });
  }

  const normalized = error instanceof FileControlError ? error : createUnexpectedFileError(error);

  if (!(error instanceof FileControlError)) {
    logError("file-route.unexpected-error", createErrorLogContext(error));
  }

  const payload: FileErrorResponse = createFileErrorResponse(normalized);
  return Response.json(payload, {
    status: normalized.status,
  });
}

export function registerFileRoute(app: Hono<ApiGatewayEnvironment>) {
  app.post("/files", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);

      if (!viewer) {
        return Response.json(createFileErrorResponse(unauthorizedFileError()), { status: 401 });
      }

      const body = await c.req.json<CreateFileUploadRequest>();
      return c.json(await createFileUpload(c.env, viewer, body));
    } catch (error) {
      return toErrorResponse(error);
    }
  });

  app.get("/files/:fileId/upload", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);

      if (!viewer) {
        return Response.json(createFileErrorResponse(unauthorizedFileError()), { status: 401 });
      }

      return c.json(
        await getFileUpload(c.env, viewer, toPlatformId<FileId>(c.req.param("fileId"), "File ID")),
      );
    } catch (error) {
      return toErrorResponse(error);
    }
  });

  app.put("/files/:fileId/content", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);

      if (!viewer) {
        return Response.json(createFileErrorResponse(unauthorizedFileError()), { status: 401 });
      }

      await uploadFileContent(
        c.env,
        viewer,
        toPlatformId<FileId>(c.req.param("fileId"), "File ID"),
        c.req.raw.body,
      );
      return c.json({ ok: true });
    } catch (error) {
      return toErrorResponse(error);
    }
  });

  app.put("/files/:fileId/parts/:partNumber", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);

      if (!viewer) {
        return Response.json(createFileErrorResponse(unauthorizedFileError()), { status: 401 });
      }

      return c.json(
        await uploadFilePart(
          c.env,
          viewer,
          toPlatformId<FileId>(c.req.param("fileId"), "File ID"),
          Number(c.req.param("partNumber")),
          c.req.raw.body,
        ),
      );
    } catch (error) {
      return toErrorResponse(error);
    }
  });

  app.post("/files/:fileId/complete", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);

      if (!viewer) {
        return Response.json(createFileErrorResponse(unauthorizedFileError()), { status: 401 });
      }

      const body = await c.req.json<CompleteFileUploadRequest>();
      return c.json(
        await completeFileUpload({
          bindings: c.env,
          fileId: toPlatformId<FileId>(c.req.param("fileId"), "File ID"),
          input: body,
          viewer,
        }),
      );
    } catch (error) {
      return toErrorResponse(error);
    }
  });

  app.delete("/files/:fileId/upload", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);

      if (!viewer) {
        return Response.json(createFileErrorResponse(unauthorizedFileError()), { status: 401 });
      }

      await abortFileUpload(c.env, viewer, toPlatformId<FileId>(c.req.param("fileId"), "File ID"));
      return c.json({ ok: true });
    } catch (error) {
      return toErrorResponse(error);
    }
  });

  app.get("/files/:fileId/content", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);

      if (!viewer) {
        return Response.json(createFileErrorResponse(unauthorizedFileError()), { status: 401 });
      }

      const requestedDisposition = c.req.query("disposition");
      const disposition =
        requestedDisposition === "inline" || requestedDisposition === "attachment"
          ? requestedDisposition
          : "attachment";

      return await streamFileContent(
        c.env,
        viewer,
        toPlatformId<FileId>(c.req.param("fileId"), "File ID"),
        disposition,
      );
    } catch (error) {
      return toErrorResponse(error);
    }
  });

  app.patch("/files/:fileId", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);

      if (!viewer) {
        return Response.json(createFileErrorResponse(unauthorizedFileError()), { status: 401 });
      }

      const body = await c.req.json<UpdateFileRequest>();
      return c.json(
        await updateSpaceFile(
          c.env,
          viewer,
          toPlatformId<FileId>(c.req.param("fileId"), "File ID"),
          body,
        ),
      );
    } catch (error) {
      return toErrorResponse(error);
    }
  });

  app.delete("/files/:fileId", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);

      if (!viewer) {
        return c.json(
          {
            error: "Unauthorized.",
          },
          401,
        );
      }

      await deleteFileById(c.env, viewer, toPlatformId<FileId>(c.req.param("fileId"), "File ID"), {
        ifMatchEtag: normalizeR2Etag(c.req.header("If-Match")),
      });
      return c.json({ ok: true });
    } catch (error) {
      return toErrorResponse(error);
    }
  });

  app.post("/apps/:appId/spaces/:spaceId/locks/acquire", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);

      if (!viewer) {
        return Response.json(createFileErrorResponse(unauthorizedFileError()), { status: 401 });
      }

      const body = await c.req.json<AcquireSpaceFileLockRequest>();
      return c.json(
        await acquireSpaceFileLock(
          c.env,
          viewer,
          toPlatformId<AppId>(c.req.param("appId"), "App ID"),
          toPlatformId<SpaceId>(c.req.param("spaceId"), "Space ID"),
          body,
        ),
      );
    } catch (error) {
      return toErrorResponse(error);
    }
  });

  app.post("/apps/:appId/spaces/:spaceId/locks/release", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);

      if (!viewer) {
        return Response.json(createFileErrorResponse(unauthorizedFileError()), { status: 401 });
      }

      const body = await c.req.json<ReleaseSpaceFileLockRequest>();
      return c.json(
        await releaseSpaceFileLock(
          c.env,
          viewer,
          toPlatformId<AppId>(c.req.param("appId"), "App ID"),
          toPlatformId<SpaceId>(c.req.param("spaceId"), "Space ID"),
          body,
        ),
      );
    } catch (error) {
      return toErrorResponse(error);
    }
  });
}
