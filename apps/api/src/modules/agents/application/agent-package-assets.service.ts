import type { AgentPackageAsset } from "@mosoo/contracts/agent-manifest";
import { fileRecordsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, FileId, OrganizationId } from "@mosoo/id";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import {
  copyObject,
  getObjectBody,
  putObject,
} from "../../files/application/file-object-storage.service";
import {
  createAttachmentPath,
  createFinalObjectKey,
} from "../../files/application/file-path.service";
import { getFileRecordById } from "../../files/application/file-record-read.service";
import type { FileRecordRow } from "../../files/application/file-record-read.service";
import { readFileId, readOrganizationId } from "./agent-platform-ids";

function getParentPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "" : path.slice(0, lastSlash);
}

function getAssetContentType(asset: Pick<AgentPackageAsset, "mimeType" | "role">): string {
  if (asset.mimeType !== null && asset.mimeType !== "") {
    return asset.mimeType;
  }

  return asset.role === "agents_md" ? "text/markdown" : "application/octet-stream";
}

function createDraftRecordShape(input: {
  fileId: FileId;
  filename: string;
  organizationId: OrganizationId;
  viewerId: AccountId;
}) {
  const path = createAttachmentPath(input.fileId, input.filename);

  return {
    created_by_account_id: input.viewerId,
    id: input.fileId,
    name: input.filename,
    path,
    scope_id: input.organizationId,
    scope_kind: "organization_draft" as const,
  };
}

export async function readFileAssetContentText(
  bindings: ApiBindings,
  file: FileRecordRow,
): Promise<string | null> {
  const object = await getObjectBody(bindings, file.object_key);

  if (!object) {
    return null;
  }

  return object.text();
}

export async function createOrganizationDraftAssetFromPackage(
  ...[bindings, viewer, organizationId, asset]: [
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    organizationId: string,
    asset: AgentPackageAsset,
  ]
): Promise<FileId | null> {
  if (asset.contentText === null) {
    return null;
  }

  const fileId = createPlatformId<FileId>();
  const normalizedOrganizationId = readOrganizationId(organizationId);
  const timestampMs = currentTimestampMs();
  const recordShape = createDraftRecordShape({
    fileId,
    filename: asset.filename,
    organizationId: normalizedOrganizationId,
    viewerId: viewer.id,
  });
  const objectKey = createFinalObjectKey(recordShape);
  const contentType = getAssetContentType(asset);
  const head = await putObject({
    bindings,
    body: asset.contentText,
    contentType,
    objectKey,
    options: {
      ifNoneMatch: "*",
    },
  });
  const size = new TextEncoder().encode(asset.contentText).byteLength;

  await getAppDatabase(bindings.DB)
    .insert(fileRecordsTable)
    .values({
      committed: false,
      createdAt: timestampMs,
      createdByAccountId: viewer.id,
      etag: head.etag,
      expiresAt: null,
      id: fileId,
      mimeType: contentType,
      name: asset.filename,
      objectKey,
      ownerId: normalizedOrganizationId,
      ownerKind: "organization",
      parentPath: getParentPath(recordShape.path),
      path: recordShape.path,
      purpose: "organization_draft",
      scopeId: normalizedOrganizationId,
      scopeKind: "organization_draft",
      sessionKind: "attachment",
      size,
      status: "ready",
      updatedAt: timestampMs,
      version: 1,
    })
    .run();

  return fileId;
}

export async function copyOrganizationDraftAsset(
  ...[bindings, viewer, organizationId, sourceFileId]: [
    bindings: ApiBindings,
    viewer: AuthenticatedViewer,
    organizationId: string,
    sourceFileId: string | null,
  ]
): Promise<FileId | null> {
  if (sourceFileId === null || sourceFileId === "") {
    return null;
  }

  const normalizedSourceFileId = readFileId(sourceFileId, "Source file ID");
  const source = await getFileRecordById(bindings.DB, normalizedSourceFileId);

  if (source?.status !== "ready") {
    return null;
  }

  const fileId = createPlatformId<FileId>();
  const normalizedOrganizationId = readOrganizationId(organizationId);
  const timestampMs = currentTimestampMs();
  const recordShape = createDraftRecordShape({
    fileId,
    filename: source.name,
    organizationId: normalizedOrganizationId,
    viewerId: viewer.id,
  });
  const objectKey = createFinalObjectKey(recordShape);
  const copyOptions =
    source.etag === null || source.etag === "" ? undefined : { sourceIfMatch: source.etag };
  const copied = await copyObject({
    bindings,
    destinationObjectKey: objectKey,
    options: copyOptions,
    sourceObjectKey: source.object_key,
  });

  await getAppDatabase(bindings.DB)
    .insert(fileRecordsTable)
    .values({
      committed: false,
      createdAt: timestampMs,
      createdByAccountId: viewer.id,
      etag: copied.etag,
      expiresAt: null,
      id: fileId,
      mimeType: source.mime_type,
      name: source.name,
      objectKey,
      ownerId: normalizedOrganizationId,
      ownerKind: "organization",
      parentPath: getParentPath(recordShape.path),
      path: recordShape.path,
      purpose: "organization_draft",
      scopeId: normalizedOrganizationId,
      scopeKind: "organization_draft",
      sessionKind: "attachment",
      size: source.size,
      status: "ready",
      updatedAt: timestampMs,
      version: 1,
    })
    .run();

  return fileId;
}
