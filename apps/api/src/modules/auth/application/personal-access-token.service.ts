import type {
  CreatePersonalAccessTokenRequest,
  CreatePersonalAccessTokenResponse,
  PersonalAccessTokenListResponse,
  PersonalAccessTokenSummary,
} from "@mosoo/contracts/auth";
import { accountsTable, personalAccessTokensTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { PersonalAccessTokenId } from "@mosoo/id";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs, toIsoString } from "../../../time";
import type { AuthenticatedViewer } from "./viewer-auth.service";
const TOKEN_SECRET_BYTE_LENGTH = 32;
const TOKEN_VALUE_PREFIX = "grt_pat_";
const MAX_LABEL_LENGTH = 80;

interface PersonalAccessTokenListRow {
  created_at: number;
  id: PersonalAccessTokenId;
  label: string;
  last_used_at: number | null;
  revoked_at: number | null;
}

export interface PersonalAccessTokenCaller {
  tokenLabel: string;
  tokenId: PersonalAccessTokenId;
  viewer: AuthenticatedViewer;
}

function normalizeTokenLabel(label: string): string {
  const normalized = label.trim();

  if (!normalized) {
    throw new Error("Token label is required.");
  }

  if (normalized.length > MAX_LABEL_LENGTH) {
    throw new Error(`Token label must be ${MAX_LABEL_LENGTH} characters or fewer.`);
  }

  return normalized;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function createTokenValue(): string {
  const bytes = new Uint8Array(TOKEN_SECRET_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return `${TOKEN_VALUE_PREFIX}${encodeBase64Url(bytes)}`;
}

export function isPersonalAccessTokenValue(tokenValue: string): boolean {
  return tokenValue.startsWith(TOKEN_VALUE_PREFIX);
}

export async function hashTokenValue(tokenValue: string): Promise<string> {
  const encoded = new TextEncoder().encode(tokenValue);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toTokenSummary(row: PersonalAccessTokenListRow): PersonalAccessTokenSummary {
  return {
    createdAt: toIsoString(row.created_at),
    id: row.id,
    label: row.label,
    lastUsedAt: row.last_used_at === null ? null : toIsoString(row.last_used_at),
    revokedAt: row.revoked_at === null ? null : toIsoString(row.revoked_at),
  };
}

export function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  const [scheme, token] = authorization?.split(/\s+/, 2) ?? [];

  if (scheme?.toLowerCase() !== "bearer" || !isTruthy(token)) {
    return null;
  }

  return token;
}

export async function listPersonalAccessTokens(
  database: D1Database,
  viewer: AuthenticatedViewer,
): Promise<PersonalAccessTokenListResponse> {
  const results = await getAppDatabase(database)
    .select({
      created_at: sql<number>`${personalAccessTokensTable.createdAt}`,
      id: personalAccessTokensTable.id,
      label: personalAccessTokensTable.label,
      last_used_at: sql<number | null>`${personalAccessTokensTable.lastUsedAt}`,
      revoked_at: sql<number | null>`${personalAccessTokensTable.revokedAt}`,
    })
    .from(personalAccessTokensTable)
    .where(eq(personalAccessTokensTable.accountId, viewer.id))
    .orderBy(desc(personalAccessTokensTable.createdAt))
    .all();

  return {
    tokens: results.map(toTokenSummary),
  };
}

export async function createPersonalAccessToken(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: CreatePersonalAccessTokenRequest,
): Promise<CreatePersonalAccessTokenResponse> {
  const label = normalizeTokenLabel(input.label);
  const tokenValue = createTokenValue();
  const tokenHash = await hashTokenValue(tokenValue);
  const timestampMs = currentTimestampMs();
  const tokenId = createPlatformId<PersonalAccessTokenId>();

  await getAppDatabase(database)
    .insert(personalAccessTokensTable)
    .values({
      accountId: viewer.id,
      createdAt: sql`${timestampMs}`,
      id: tokenId,
      label,
      lastUsedAt: null,
      revokedAt: null,
      tokenHash,
      updatedAt: sql`${timestampMs}`,
    })
    .run();

  return {
    token: {
      createdAt: toIsoString(timestampMs),
      id: tokenId,
      label,
      lastUsedAt: null,
      revokedAt: null,
    },
    value: tokenValue,
  };
}

export async function revokePersonalAccessToken(
  database: D1Database,
  viewer: AuthenticatedViewer,
  tokenId: PersonalAccessTokenId,
): Promise<void> {
  const timestampMs = currentTimestampMs();
  const token =
    (await getAppDatabase(database)
      .select({
        id: personalAccessTokensTable.id,
      })
      .from(personalAccessTokensTable)
      .where(
        and(
          eq(personalAccessTokensTable.id, tokenId),
          eq(personalAccessTokensTable.accountId, viewer.id),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!token) {
    return;
  }

  await getAppDatabase(database)
    .update(personalAccessTokensTable)
    .set({
      revokedAt: sql`COALESCE(${personalAccessTokensTable.revokedAt}, ${timestampMs})`,
      updatedAt: sql`${timestampMs}`,
    })
    .where(
      and(
        eq(personalAccessTokensTable.id, tokenId),
        eq(personalAccessTokensTable.accountId, viewer.id),
      ),
    )
    .run();
}

export async function authenticatePersonalAccessToken(
  database: D1Database,
  tokenValue: string,
): Promise<PersonalAccessTokenCaller | null> {
  if (!isPersonalAccessTokenValue(tokenValue)) {
    return null;
  }

  const tokenHash = await hashTokenValue(tokenValue);
  const row =
    (await getAppDatabase(database)
      .select({
        account_email: accountsTable.email,
        account_email_verified: sql<number>`${accountsTable.emailVerified}`,
        account_id: sql`${accountsTable.id}`.mapWith(accountsTable.id).as("account_id"),
        account_image_url: accountsTable.image,
        account_name: accountsTable.name,
        id: sql`${personalAccessTokensTable.id}`.mapWith(personalAccessTokensTable.id).as("id"),
        label: personalAccessTokensTable.label,
      })
      .from(personalAccessTokensTable)
      .innerJoin(accountsTable, eq(accountsTable.id, personalAccessTokensTable.accountId))
      .where(
        and(
          eq(personalAccessTokensTable.tokenHash, tokenHash),
          isNull(personalAccessTokensTable.revokedAt),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  const timestampMs = currentTimestampMs();

  await getAppDatabase(database)
    .update(personalAccessTokensTable)
    .set({
      lastUsedAt: sql`${timestampMs}`,
      updatedAt: sql`${timestampMs}`,
    })
    .where(eq(personalAccessTokensTable.id, row.id))
    .run();

  return {
    tokenId: row.id,
    tokenLabel: row.label,
    viewer: {
      email: row.account_email,
      emailVerified: row.account_email_verified === 1,
      id: row.account_id,
      imageUrl: row.account_image_url,
      name: row.account_name,
    },
  };
}
