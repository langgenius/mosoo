import type { SpaceAliasBinding } from "@mosoo/contracts/sandbox";

import { isTruthy } from "../../../shared/truthiness";
import type {
  RuntimeArtifactSummaryChange,
  RuntimeFileChangeInput,
} from "./runtime-space-file-changes";
import {
  deleteRuntimeSpaceFileRecord,
  listRuntimeSpaceFileRecords,
  upsertRuntimeSpaceFileRecord,
} from "./runtime-space-file-records";
import {
  deleteRuntimeSpaceObject,
  getRuntimeSpaceObject,
  putRuntimeSpaceObject,
} from "./runtime-space-object-store";
import type { RuntimeSpaceObjectBucket } from "./runtime-space-object-store";
import {
  createRuntimeSpaceObjectKey,
  isHiddenRuntimeSpacePath,
  joinRuntimeSandboxSpacePath,
  readRuntimeSpaceMountPath,
  resolveRuntimeSpacePath,
} from "./runtime-space-paths";
import type { RuntimeSpacePathResolution } from "./runtime-space-paths";
import { readSandboxFileBytes, writeSandboxFileBytes } from "./sandbox-file-bytes";
import type { ExecutionSessionHandle } from "./sandbox-handles";
import { listSandboxSpaceFilePaths } from "./sandbox-space-file-sync-platform";

interface RuntimeSpaceFileSyncBindings {
  DB: D1Database;
  FILE_BUCKET: RuntimeSpaceObjectBucket;
}

interface RuntimeSpaceFileMutationInput {
  bindings: RuntimeSpaceFileSyncBindings;
  executionOwnerUserId: string | null;
  fileReader: ExecutionSessionHandle;
  spaceAliases: SpaceAliasBinding[];
}

interface RuntimeSpaceFileTreeInput {
  bindings: RuntimeSpaceFileSyncBindings;
  sandbox: ExecutionSessionHandle;
  spaceAliases: SpaceAliasBinding[];
}

async function putSandboxSpaceFile(
  input: RuntimeSpaceFileMutationInput,
  fileChange: RuntimeFileChangeInput,
  resolution: RuntimeSpacePathResolution,
): Promise<{ etag: string | null; size: number }> {
  const bytes = await readSandboxFileBytes(input.fileReader, fileChange.path);
  const objectKey = createRuntimeSpaceObjectKey(resolution);

  return putRuntimeSpaceObject(input.bindings.FILE_BUCKET, objectKey, bytes);
}

export async function syncSandboxSpaceFileMutation(
  input: RuntimeSpaceFileMutationInput,
  fileChange: RuntimeFileChangeInput,
): Promise<RuntimeArtifactSummaryChange> {
  if (!isTruthy(input.executionOwnerUserId)) {
    return null;
  }

  const resolved = resolveRuntimeSpacePath(input.spaceAliases, fileChange.path);

  if (!isTruthy(resolved?.relativePath)) {
    return null;
  }

  if (isHiddenRuntimeSpacePath(resolved.relativePath)) {
    return null;
  }

  if (fileChange.change === "delete") {
    const deletion = await deleteRuntimeSpaceFileRecord(input.bindings.DB, resolved);

    if (deletion.deletedObjectKey !== null) {
      await deleteRuntimeSpaceObject(input.bindings.FILE_BUCKET, deletion.deletedObjectKey);
    }

    return deletion.artifactChange;
  }

  const object = await putSandboxSpaceFile(input, fileChange, resolved);
  const upsert = await upsertRuntimeSpaceFileRecord({
    database: input.bindings.DB,
    etag: object.etag,
    ownerUserId: input.executionOwnerUserId,
    resolution: resolved,
    size: object.size,
  });

  if (upsert.replacedObjectKey !== null) {
    await deleteRuntimeSpaceObject(input.bindings.FILE_BUCKET, upsert.replacedObjectKey);
  }

  return upsert.artifactChange;
}

export async function syncSandboxSpaceTreesToCanonical(input: {
  bindings: RuntimeSpaceFileSyncBindings;
  executionOwnerUserId: string | null;
  sandbox: ExecutionSessionHandle;
  spaceAliases: SpaceAliasBinding[];
}): Promise<void> {
  if (!isTruthy(input.executionOwnerUserId)) {
    return;
  }

  for (const alias of input.spaceAliases) {
    const globalMountPath = readRuntimeSpaceMountPath(alias.globalMountPath);
    const paths = await listSandboxSpaceFilePaths(input.sandbox, globalMountPath);

    for (const path of paths) {
      await syncSandboxSpaceFileMutation(
        {
          bindings: input.bindings,
          executionOwnerUserId: input.executionOwnerUserId,
          fileReader: input.sandbox,
          spaceAliases: input.spaceAliases,
        },
        {
          change: "upsert",
          path,
        },
      );
    }
  }
}

export async function hydrateSandboxSpaceTreesFromCanonical(
  input: RuntimeSpaceFileTreeInput,
): Promise<void> {
  for (const alias of input.spaceAliases) {
    const globalMountPath = readRuntimeSpaceMountPath(alias.globalMountPath);
    const rows = await listRuntimeSpaceFileRecords(input.bindings.DB, alias.spaceId);

    for (const row of rows) {
      if (isHiddenRuntimeSpacePath(row.path)) {
        continue;
      }

      const bytes = await getRuntimeSpaceObject(input.bindings.FILE_BUCKET, row.objectKey);

      if (bytes === null) {
        continue;
      }

      await writeSandboxFileBytes(
        input.sandbox,
        joinRuntimeSandboxSpacePath(globalMountPath, row.path),
        bytes,
      );
    }
  }
}
