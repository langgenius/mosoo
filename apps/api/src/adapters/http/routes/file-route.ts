import { FILE_SCOPE_KINDS, FILE_SESSION_KINDS } from "@mosoo/contracts/file";
import type {
  CompleteFileUploadRequest,
  CreateFileUploadRequest,
  FileErrorResponse,
  UpdateFileRequest,
} from "@mosoo/contracts/file";
import type {
  FileListQuery,
  FileScopeId,
  FileScopeKind,
  FileSessionKind,
} from "@mosoo/contracts/file";
import type { FileId } from "@mosoo/id";
import type { Hono } from "hono";

import { getViewerFromRequest } from "../../../modules/auth/application/viewer-auth.service";
import {
  FileControlError,
  createFileErrorResponse,
  createUnexpectedFileError,
  fileStore,
  normalizeR2Etag,
} from "../../../modules/files/application/file-store";
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

function readFileScopeKind(value: string | undefined): FileScopeKind | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  if ((FILE_SCOPE_KINDS as readonly string[]).includes(value)) {
    return value as FileScopeKind;
  }

  throw new FileControlError(400, "file_invalid_request", "Invalid file scope kind.");
}

function readFileSessionKind(value: string | undefined): FileSessionKind | null | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  if (value === "all") {
    return null;
  }

  if ((FILE_SESSION_KINDS as readonly string[]).includes(value)) {
    return value as FileSessionKind;
  }

  throw new FileControlError(400, "file_invalid_request", "Invalid file session kind.");
}

function readFileListQuery(
  scopeIdValue: string | undefined,
  c: { req: { query: (name: string) => string | undefined } },
): FileListQuery {
  const scopeId =
    scopeIdValue === undefined || scopeIdValue.trim().length === 0
      ? undefined
      : (toPlatformId(scopeIdValue, "File scope ID") as Exclude<FileScopeId, null>);
  const sessionKind = readFileSessionKind(c.req.query("sessionKind"));
  const requestedScopeKind = readFileScopeKind(c.req.query("scopeKind"));
  const scopeKind = requestedScopeKind ?? (scopeId === undefined ? undefined : "session");

  return {
    ...(scopeId === undefined ? {} : { scopeId }),
    ...(sessionKind === undefined ? {} : { sessionKind }),
    ...(scopeKind === undefined ? {} : { scopeKind }),
  };
}

export function registerFileRoute(app: Hono<ApiGatewayEnvironment>) {
  app.get("/files", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);

      if (!viewer) {
        return Response.json(createFileErrorResponse(unauthorizedFileError()), { status: 401 });
      }

      return c.json(
        await fileStore.list(c.env, viewer, readFileListQuery(c.req.query("scopeId"), c)),
      );
    } catch (error) {
      return toErrorResponse(error);
    }
  });

  app.post("/files", async (c) => {
    try {
      const viewer = await getViewerFromRequest(c.env, c.req.raw);

      if (!viewer) {
        return Response.json(createFileErrorResponse(unauthorizedFileError()), { status: 401 });
      }

      const body = await c.req.json<CreateFileUploadRequest>();
      return c.json(await fileStore.createUpload(c.env, viewer, body));
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
        await fileStore.getUpload(
          c.env,
          viewer,
          toPlatformId<FileId>(c.req.param("fileId"), "File ID"),
        ),
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

      await fileStore.putContent(
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
        await fileStore.putPart(
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
        await fileStore.completeUpload({
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

      await fileStore.abortUpload(
        c.env,
        viewer,
        toPlatformId<FileId>(c.req.param("fileId"), "File ID"),
      );
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

      return await fileStore.streamContent(
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
        await fileStore.update(
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

      await fileStore.delete(
        c.env,
        viewer,
        toPlatformId<FileId>(c.req.param("fileId"), "File ID"),
        {
          ifMatchEtag: normalizeR2Etag(c.req.header("If-Match")),
        },
      );
      return c.json({ ok: true });
    } catch (error) {
      return toErrorResponse(error);
    }
  });
}
