import type {
  AcquireSpaceFileLockRequest,
  AcquireSpaceFileLockResponse,
  ReleaseSpaceFileLockRequest,
  ReleaseSpaceFileLockResponse,
  SpaceFileLockHolder,
  SpaceFileLockView,
} from "@mosoo/contracts/space";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, AppId, SpaceId } from "@mosoo/id";

import { createErrorLogContext, logWarn } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { createFileConflictError } from "./file-errors";
import { normalizeSpaceFilePath } from "./file-paths";
import { deleteObject, getObjectBody, normalizeR2Etag, putObject } from "./r2-s3-client";
import { ensureSpaceAccess } from "./space-access";
const DEFAULT_LOCK_TTL_SECONDS = 30;
const MAX_LOCK_TTL_SECONDS = 5 * 60;
const LOCK_CONTENT_TYPE = "application/json";
const SPACE_FILE_LOCK_PREFIX = "_internal/space-file-locks";

interface SpaceFileLockPayload {
  expires_at: number;
  holder: SpaceFileLockHolder;
  lock_id: string;
  path: string;
}

interface StoredSpaceFileLock {
  etag: string;
  payload: SpaceFileLockPayload;
}

function normalizeTtlSeconds(ttlSeconds: number | undefined): number {
  if (!Number.isFinite(ttlSeconds ?? DEFAULT_LOCK_TTL_SECONDS)) {
    return DEFAULT_LOCK_TTL_SECONDS;
  }

  return Math.min(
    Math.max(Math.floor(ttlSeconds ?? DEFAULT_LOCK_TTL_SECONDS), 1),
    MAX_LOCK_TTL_SECONDS,
  );
}

function createHolder(viewer: AuthenticatedViewer): SpaceFileLockHolder {
  return {
    displayName: viewer.name || viewer.email,
    id: parsePlatformId<AccountId>(viewer.id, "viewer ID"),
    type: "user",
  };
}

function createLockObjectKey(spaceId: SpaceId, path: string): string {
  return `${SPACE_FILE_LOCK_PREFIX}/${spaceId}/${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseLockPayload(value: unknown): SpaceFileLockPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const { holder } = value;
  const lockId = value["lock_id"];
  const { path } = value;
  const expiresAt = value["expires_at"];

  if (
    !isRecord(holder) ||
    typeof holder["id"] !== "string" ||
    (holder["type"] !== "agent" && holder["type"] !== "user") ||
    typeof lockId !== "string" ||
    typeof path !== "string" ||
    typeof expiresAt !== "number"
  ) {
    return null;
  }

  if (holder["type"] === "agent") {
    return {
      expires_at: expiresAt,
      holder: {
        displayName: typeof holder["displayName"] === "string" ? holder["displayName"] : null,
        id: parsePlatformId<AgentId>(holder["id"], "space file lock holder ID"),
        type: holder["type"],
      },
      lock_id: lockId,
      path,
    };
  }

  return {
    expires_at: expiresAt,
    holder: {
      displayName: typeof holder["displayName"] === "string" ? holder["displayName"] : null,
      id: parsePlatformId<AccountId>(holder["id"], "space file lock holder ID"),
      type: holder["type"],
    },
    lock_id: lockId,
    path,
  };
}

async function readLock(
  bindings: ApiBindings,
  objectKey: string,
): Promise<StoredSpaceFileLock | null> {
  const object = await getObjectBody(bindings, objectKey);

  if (!object) {
    return null;
  }

  const payload = parseLockPayload(await object.json<unknown>().catch(() => null));

  if (!payload) {
    return null;
  }

  return {
    etag: object.etag,
    payload,
  };
}

function toLockView(payload: SpaceFileLockPayload): SpaceFileLockView {
  return {
    expiresAt: payload.expires_at,
    holder: payload.holder,
    path: payload.path,
  };
}

function isExpired(lock: SpaceFileLockPayload, now = currentTimestampMs()): boolean {
  return lock.expires_at <= now;
}

async function deleteLock(
  bindings: ApiBindings,
  objectKey: string,
  etag: string,
): Promise<boolean> {
  try {
    await deleteObject(bindings, objectKey, {
      ifMatch: etag,
    });
    return true;
  } catch (error) {
    logWarn("space.lock.delete.rejected", {
      ...createErrorLogContext(error),
      objectKey,
    });
    return false;
  }
}

function isSameHolder(left: SpaceFileLockHolder, right: SpaceFileLockHolder): boolean {
  return left.type === right.type && left.id === right.id;
}

export async function acquireSpaceFileLock(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  appId: AppId,
  spaceId: SpaceId,
  input: AcquireSpaceFileLockRequest,
): Promise<AcquireSpaceFileLockResponse> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureSpaceAccess(bindings.DB, viewerId, appId, spaceId, "edit");

  const path = normalizeSpaceFilePath(input.path);
  const holder = createHolder(viewer);
  const objectKey = createLockObjectKey(spaceId, path);
  const existing = await readLock(bindings, objectKey);
  const ttlSeconds = normalizeTtlSeconds(input.ttlSeconds);
  const expiresAt = currentTimestampMs() + ttlSeconds * 1000;

  if (existing && isExpired(existing.payload)) {
    await deleteLock(bindings, objectKey, existing.etag);
  } else if (existing && !isSameHolder(existing.payload.holder, holder)) {
    return {
      expiresAt: existing.payload.expires_at,
      holder: existing.payload.holder,
      ok: false,
    };
  } else if (existing) {
    const payload: SpaceFileLockPayload = {
      ...existing.payload,
      expires_at: expiresAt,
      holder,
    };

    await putObject({
      bindings,
      body: JSON.stringify(payload),
      contentType: LOCK_CONTENT_TYPE,
      objectKey,
      options: {
        ifMatch: existing.etag,
      },
    });

    return {
      expiresAt: payload.expires_at,
      holder: payload.holder,
      lockId: payload.lock_id,
      ok: true,
    };
  }

  const payload: SpaceFileLockPayload = {
    expires_at: expiresAt,
    holder,
    lock_id: crypto.randomUUID(),
    path,
  };

  try {
    await putObject({
      bindings,
      body: JSON.stringify(payload),
      contentType: LOCK_CONTENT_TYPE,
      objectKey,
      options: {
        ifNoneMatch: "*",
      },
    });
  } catch (error) {
    const current = await readLock(bindings, objectKey);

    if (current) {
      return {
        expiresAt: current.payload.expires_at,
        holder: current.payload.holder,
        ok: false,
      };
    }

    throw error;
  }

  return {
    expiresAt: payload.expires_at,
    holder: payload.holder,
    lockId: payload.lock_id,
    ok: true,
  };
}

export async function releaseSpaceFileLock(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  appId: AppId,
  spaceId: SpaceId,
  input: ReleaseSpaceFileLockRequest,
): Promise<ReleaseSpaceFileLockResponse> {
  const viewerId: AccountId = parsePlatformId(viewer.id, "viewer ID");
  await ensureSpaceAccess(bindings.DB, viewerId, appId, spaceId, "edit");

  const path = normalizeSpaceFilePath(input.path);
  const objectKey = createLockObjectKey(spaceId, path);
  const existing = await readLock(bindings, objectKey);

  if (!existing || isExpired(existing.payload)) {
    if (existing) {
      return { ok: await deleteLock(bindings, objectKey, existing.etag) };
    }

    return { ok: true };
  }

  if (
    existing.payload.holder.type !== "user" ||
    existing.payload.holder.id !== viewerId ||
    (Boolean(input.lockId) && input.lockId !== existing.payload.lock_id)
  ) {
    return { ok: false };
  }

  return { ok: await deleteLock(bindings, objectKey, existing.etag) };
}

export async function ensureSpaceFileWriteUnlocked(
  bindings: ApiBindings,
  viewer: AuthenticatedViewer,
  spaceId: SpaceId,
  path: string,
): Promise<void> {
  const normalizedPath = normalizeSpaceFilePath(path);
  const objectKey = createLockObjectKey(spaceId, normalizedPath);
  const existing = await readLock(bindings, objectKey);

  if (!existing) {
    return;
  }

  if (isExpired(existing.payload)) {
    await deleteLock(bindings, objectKey, existing.etag);
    return;
  }

  if (isSameHolder(existing.payload.holder, createHolder(viewer))) {
    return;
  }

  throw createFileConflictError("File is locked by another editor.");
}

export async function listActiveSpaceFileLocks(
  bindings: ApiBindings,
  spaceId: SpaceId,
  paths: string[],
): Promise<Map<string, SpaceFileLockView>> {
  const locks = new Map<string, SpaceFileLockView>();

  await Promise.all(
    paths.map(async (path) => {
      const normalizedPath = normalizeSpaceFilePath(path);
      const objectKey = createLockObjectKey(spaceId, normalizedPath);
      const existing = await readLock(bindings, objectKey);

      if (!existing) {
        return;
      }

      if (isExpired(existing.payload)) {
        await deleteLock(bindings, objectKey, existing.etag);
        return;
      }

      locks.set(normalizedPath, toLockView(existing.payload));
    }),
  );

  return locks;
}

export async function cleanupExpiredSpaceFileLocks(bindings: ApiBindings): Promise<void> {
  let cursor: string | undefined;

  do {
    const listOptions: R2ListOptions = {
      prefix: `${SPACE_FILE_LOCK_PREFIX}/`,
    };

    if (isTruthy(cursor)) {
      listOptions.cursor = cursor;
    }

    const listed = await bindings.FILE_BUCKET.list(listOptions);

    await Promise.all(
      listed.objects.map(async (object) => {
        const stored = await readLock(bindings, object.key);

        if (!stored || !isExpired(stored.payload)) {
          return;
        }

        await deleteLock(bindings, object.key, normalizeR2Etag(stored.etag) ?? stored.etag);
      }),
    );

    cursor = listed.truncated ? listed.cursor : undefined;
  } while (isTruthy(cursor));
}
