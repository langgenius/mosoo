import { accountsTable } from "@mosoo/db";
import type { AccountId, PersonalAccessTokenId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import {
  authenticatePersonalAccessToken,
  isPersonalAccessTokenValue,
  readBearerToken,
} from "./personal-access-token.service";
import type { PersonalAccessTokenCaller } from "./personal-access-token.service";
import type { AuthenticatedViewer } from "./viewer-auth.service";

type AccessTokenCredentialSubjectId = `human:${AccountId}`;

export interface AccessTokenPublicApiCaller {
  credentialSubjectId: AccessTokenCredentialSubjectId;
  kind: "access_token";
  tokenId: PersonalAccessTokenId;
  tokenLabel: string;
  viewer: AuthenticatedViewer;
}

export type PublicApiCaller = AccessTokenPublicApiCaller;

function toAccessTokenCredentialSubjectId(accountId: AccountId): AccessTokenCredentialSubjectId {
  return `human:${accountId}`;
}

function toAccessTokenCaller(caller: PersonalAccessTokenCaller): AccessTokenPublicApiCaller {
  return {
    credentialSubjectId: toAccessTokenCredentialSubjectId(caller.viewer.id),
    kind: "access_token",
    tokenId: caller.tokenId,
    tokenLabel: caller.tokenLabel,
    viewer: caller.viewer,
  };
}

export async function getAccountViewer(
  database: D1Database,
  accountId: AccountId,
): Promise<AuthenticatedViewer | null> {
  const row =
    (await getAppDatabase(database)
      .select({
        email: accountsTable.email,
        email_verified: accountsTable.emailVerified,
        id: accountsTable.id,
        image_url: accountsTable.image,
        name: accountsTable.name,
      })
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return {
    email: row.email,
    emailVerified: row.email_verified,
    id: row.id,
    imageUrl: row.image_url,
    name: row.name,
  };
}

export async function authenticatePublicApiCaller(
  database: D1Database,
  tokenValue: string,
): Promise<PublicApiCaller | null> {
  if (isPersonalAccessTokenValue(tokenValue)) {
    const accessTokenCaller = await authenticatePersonalAccessToken(database, tokenValue);
    return accessTokenCaller === null ? null : toAccessTokenCaller(accessTokenCaller);
  }

  return null;
}

export function readPublicApiBearerToken(request: Request): string | null {
  return readBearerToken(request);
}
