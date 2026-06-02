import { accountsTable, organizationServiceTokensTable } from "@mosoo/db";
import type {
  AccountId,
  OrganizationId,
  OrganizationServiceTokenId,
  PersonalAccessTokenId,
} from "@mosoo/id";
import { and, eq, isNull, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { currentTimestampMs } from "../../../time";
import { isOrganizationServiceTokenValue } from "./organization-service-token.service";
import {
  authenticatePersonalAccessToken,
  hashTokenValue,
  isPersonalAccessTokenValue,
  readBearerToken,
} from "./personal-access-token.service";
import type { PersonalAccessTokenCaller } from "./personal-access-token.service";
import type { AuthenticatedViewer } from "./viewer-auth.service";

type HumanPatCredentialSubjectId = `human:${AccountId}`;
type ServiceTokenCredentialSubjectId = `service_token:${OrganizationServiceTokenId}`;

export interface HumanPatPublicApiCaller {
  credentialSubjectId: HumanPatCredentialSubjectId;
  kind: "human_pat";
  tokenId: PersonalAccessTokenId;
  tokenLabel: string;
  viewer: AuthenticatedViewer;
}

export interface ServiceTokenPublicApiCaller {
  allowAttribution: boolean;
  credentialSubjectId: ServiceTokenCredentialSubjectId;
  kind: "service_token";
  organizationId: OrganizationId;
  tokenId: OrganizationServiceTokenId;
  tokenLabel: string;
}

export type PublicApiCaller = HumanPatPublicApiCaller | ServiceTokenPublicApiCaller;

function toHumanPatCredentialSubjectId(accountId: AccountId): HumanPatCredentialSubjectId {
  return `human:${accountId}`;
}

function toServiceTokenCredentialSubjectId(
  tokenId: OrganizationServiceTokenId,
): ServiceTokenCredentialSubjectId {
  return `service_token:${tokenId}`;
}

function toHumanPatCaller(caller: PersonalAccessTokenCaller): HumanPatPublicApiCaller {
  return {
    credentialSubjectId: toHumanPatCredentialSubjectId(caller.viewer.id),
    kind: "human_pat",
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

export async function authenticateOrganizationServiceToken(
  database: D1Database,
  tokenValue: string,
): Promise<ServiceTokenPublicApiCaller | null> {
  if (!isOrganizationServiceTokenValue(tokenValue)) {
    return null;
  }

  const tokenHash = await hashTokenValue(tokenValue);
  const row =
    (await getAppDatabase(database)
      .select({
        allow_attribution: organizationServiceTokensTable.allowAttribution,
        id: sql`${organizationServiceTokensTable.id}`
          .mapWith(organizationServiceTokensTable.id)
          .as("id"),
        label: organizationServiceTokensTable.label,
        organization_id: organizationServiceTokensTable.organizationId,
      })
      .from(organizationServiceTokensTable)
      .where(
        and(
          eq(organizationServiceTokensTable.tokenHash, tokenHash),
          isNull(organizationServiceTokensTable.revokedAt),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  const timestampMs = currentTimestampMs();
  await getAppDatabase(database)
    .update(organizationServiceTokensTable)
    .set({
      lastUsedAt: sql`${timestampMs}`,
      updatedAt: sql`${timestampMs}`,
    })
    .where(eq(organizationServiceTokensTable.id, row.id))
    .run();

  return {
    allowAttribution: row.allow_attribution,
    credentialSubjectId: toServiceTokenCredentialSubjectId(row.id),
    kind: "service_token",
    organizationId: row.organization_id,
    tokenId: row.id,
    tokenLabel: row.label,
  };
}

export async function authenticatePublicApiCaller(
  database: D1Database,
  tokenValue: string,
): Promise<PublicApiCaller | null> {
  if (isPersonalAccessTokenValue(tokenValue)) {
    const patCaller = await authenticatePersonalAccessToken(database, tokenValue);
    return patCaller === null ? null : toHumanPatCaller(patCaller);
  }

  if (isOrganizationServiceTokenValue(tokenValue)) {
    return authenticateOrganizationServiceToken(database, tokenValue);
  }

  return null;
}

export function readPublicApiBearerToken(request: Request): string | null {
  return readBearerToken(request);
}
