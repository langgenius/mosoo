import type {
  CreateWorkspaceApiKeyResponse,
  WorkspaceApiKeyListResponse,
  WorkspaceApiKeySummary,
} from "@mosoo/contracts/auth";
import { accountsTable, workspaceApiKeysTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, AppId, WorkspaceApiKeyId } from "@mosoo/id";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { toBase64Url } from "../../../shared/bytes";
import { currentTimestampMs, toIsoString } from "../../../time";
import { ensureAppOwnership } from "../../apps/application/app.service";
import { hashTokenValue, readBearerToken } from "./personal-access-token.service";
import type { AuthenticatedViewer } from "./viewer-auth.service";

const WORKSPACE_API_KEY_PREFIX = "msk_";
const TOKEN_SECRET_BYTE_LENGTH = 32;
const MAX_LABEL_LENGTH = 80;

interface WorkspaceApiKeyListRow {
  created_at: number;
  id: WorkspaceApiKeyId;
  label: string;
  last_used_at: number | null;
  revoked_at: number | null;
  workspace_id: AppId;
}

export interface WorkspaceApiKeyCaller {
  keyId: WorkspaceApiKeyId;
  keyLabel: string;
  viewer: AuthenticatedViewer;
  workspaceId: AppId;
}

function normalizeLabel(label: string): string {
  const normalized = label.trim();

  if (normalized.length === 0) {
    throw new Error("API key label is required.");
  }

  if (normalized.length > MAX_LABEL_LENGTH) {
    throw new Error(`API key label must be ${MAX_LABEL_LENGTH} characters or fewer.`);
  }

  return normalized;
}

function createKeyValue(): string {
  const bytes = new Uint8Array(TOKEN_SECRET_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return `${WORKSPACE_API_KEY_PREFIX}${toBase64Url(bytes)}`;
}

function toSummary(row: WorkspaceApiKeyListRow): WorkspaceApiKeySummary {
  return {
    createdAt: toIsoString(row.created_at),
    id: row.id,
    label: row.label,
    lastUsedAt: row.last_used_at === null ? null : toIsoString(row.last_used_at),
    revokedAt: row.revoked_at === null ? null : toIsoString(row.revoked_at),
    workspaceId: row.workspace_id,
  };
}

export function isWorkspaceApiKeyValue(value: string): boolean {
  return value.startsWith(WORKSPACE_API_KEY_PREFIX);
}

export async function listWorkspaceApiKeys(
  database: D1Database,
  viewer: AuthenticatedViewer,
  workspaceId: AppId,
): Promise<WorkspaceApiKeyListResponse> {
  await ensureAppOwnership(database, viewer.id, workspaceId);
  const rows = await getAppDatabase(database)
    .select({
      created_at: sql<number>`${workspaceApiKeysTable.createdAt}`,
      id: workspaceApiKeysTable.id,
      label: workspaceApiKeysTable.label,
      last_used_at: sql<number | null>`${workspaceApiKeysTable.lastUsedAt}`,
      revoked_at: sql<number | null>`${workspaceApiKeysTable.revokedAt}`,
      workspace_id: workspaceApiKeysTable.appId,
    })
    .from(workspaceApiKeysTable)
    .where(
      and(
        eq(workspaceApiKeysTable.accountId, viewer.id),
        eq(workspaceApiKeysTable.appId, workspaceId),
        isNull(workspaceApiKeysTable.revokedAt),
      ),
    )
    .orderBy(desc(workspaceApiKeysTable.createdAt))
    .all();

  return { keys: rows.map(toSummary) };
}

export async function createWorkspaceApiKey(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: { label: string; workspaceId: AppId },
): Promise<CreateWorkspaceApiKeyResponse> {
  await ensureAppOwnership(database, viewer.id, input.workspaceId);
  const label = normalizeLabel(input.label);
  const value = createKeyValue();
  const tokenHash = await hashTokenValue(value);
  const timestampMs = currentTimestampMs();
  const keyId = createPlatformId<WorkspaceApiKeyId>();

  await getAppDatabase(database)
    .insert(workspaceApiKeysTable)
    .values({
      accountId: viewer.id,
      createdAt: sql`${timestampMs}`,
      id: keyId,
      label,
      lastUsedAt: null,
      revokedAt: null,
      appId: input.workspaceId,
      tokenHash,
      updatedAt: sql`${timestampMs}`,
    })
    .run();

  return {
    key: toSummary({
      created_at: timestampMs,
      id: keyId,
      label,
      last_used_at: null,
      revoked_at: null,
      workspace_id: input.workspaceId,
    }),
    value,
  };
}

export async function revokeWorkspaceApiKey(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: { keyId: WorkspaceApiKeyId; workspaceId: AppId },
): Promise<void> {
  await ensureAppOwnership(database, viewer.id, input.workspaceId);
  const timestampMs = currentTimestampMs();
  await getAppDatabase(database)
    .update(workspaceApiKeysTable)
    .set({
      revokedAt: sql`COALESCE(${workspaceApiKeysTable.revokedAt}, ${timestampMs})`,
      updatedAt: sql`${timestampMs}`,
    })
    .where(
      and(
        eq(workspaceApiKeysTable.id, input.keyId),
        eq(workspaceApiKeysTable.accountId, viewer.id),
        eq(workspaceApiKeysTable.appId, input.workspaceId),
      ),
    )
    .run();
}

export async function authenticateWorkspaceApiKey(
  database: D1Database,
  value: string,
): Promise<WorkspaceApiKeyCaller | null> {
  if (!isWorkspaceApiKeyValue(value)) {
    return null;
  }

  const tokenHash = await hashTokenValue(value);
  const row =
    (await getAppDatabase(database)
      .select({
        account_email: accountsTable.email,
        account_email_verified: sql<number>`${accountsTable.emailVerified}`,
        account_id: sql<AccountId>`${accountsTable.id}`.as("account_id"),
        account_image_url: accountsTable.image,
        account_name: accountsTable.name,
        id: workspaceApiKeysTable.id,
        label: workspaceApiKeysTable.label,
        workspace_id: workspaceApiKeysTable.appId,
      })
      .from(workspaceApiKeysTable)
      .innerJoin(accountsTable, eq(accountsTable.id, workspaceApiKeysTable.accountId))
      .where(
        and(
          eq(workspaceApiKeysTable.tokenHash, tokenHash),
          isNull(workspaceApiKeysTable.revokedAt),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (row === null) {
    return null;
  }

  await getAppDatabase(database)
    .update(workspaceApiKeysTable)
    .set({ lastUsedAt: sql`${currentTimestampMs()}` })
    .where(eq(workspaceApiKeysTable.id, row.id))
    .run();

  return {
    keyId: row.id,
    keyLabel: row.label,
    viewer: {
      email: row.account_email,
      emailVerified: row.account_email_verified === 1,
      id: row.account_id,
      imageUrl: row.account_image_url,
      name: row.account_name,
    },
    workspaceId: row.workspace_id,
  };
}

export function readWorkspaceApiKey(request: Request): string | null {
  const value = readBearerToken(request);
  return value !== null && isWorkspaceApiKeyValue(value) ? value : null;
}
