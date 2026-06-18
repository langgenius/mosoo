import type { FileId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createFileConflictError, createFileNotFoundError } from "./file-errors";
import { createDownloadDisposition } from "./file-paths";
import { ensureFileAccess } from "./file-record-store";
import { getObjectBody } from "./r2-s3-client";

export async function streamFileContent(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  fileId: FileId,
  disposition: "attachment" | "inline" = "attachment",
): Promise<Response> {
  const file = await ensureFileAccess({
    database: bindings.DB,
    fileId,
    requiredIntent: "view",
    viewer,
  });

  if (file.status !== "ready") {
    throw createFileConflictError("Only a ready file can be downloaded.");
  }

  const object = await getObjectBody(bindings, file.object_key);

  if (!object?.body) {
    throw createFileNotFoundError("File content was not found in R2.");
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Disposition", createDownloadDisposition(file.name, disposition));
  headers.set("Content-Length", String(object.size));
  headers.set("ETag", object.httpEtag);

  return new Response(object.body, {
    headers,
  });
}
