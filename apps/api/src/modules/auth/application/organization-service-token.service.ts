import type {
  CreateOrganizationServiceTokenRequest,
  CreateOrganizationServiceTokenResponse,
  OrganizationServiceTokenListResponse,
  OrganizationServiceTokenSummary,
} from "@mosoo/contracts/auth";
import type { OrganizationMemberRole } from "@mosoo/contracts/organization";
import { Permission, can } from "@mosoo/contracts/permission";
import {
  agentsTable,
  organizationMembersTable,
  organizationServiceTokenAgentsTable,
  organizationServiceTokensTable,
  organizationsTable,
} from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { AccountId, AgentId, OrganizationId, OrganizationServiceTokenId } from "@mosoo/id";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { forbiddenError, validationError } from "../../../platform/errors";
import { currentTimestampMs, toIsoString } from "../../../time";
import { hashTokenValue } from "./personal-access-token.service";
import type { AuthenticatedViewer } from "./viewer-auth.service";

const TOKEN_SECRET_BYTE_LENGTH = 32;
const TOKEN_VALUE_PREFIX = "grt_svc_";
const MAX_LABEL_LENGTH = 80;
const MAX_ALLOWED_AGENT_IDS = 100;

interface OrganizationServiceTokenListRow {
  allow_attribution: boolean;
  created_at: number;
  created_by_account_id: AccountId;
  id: OrganizationServiceTokenId;
  label: string;
  last_used_at: number | null;
  organization_id: OrganizationId;
  revoked_at: number | null;
}

interface OrganizationServiceTokenListAdmissionRow {
  allow_attribution: boolean | null;
  allowed_agent_id: AgentId | null;
  created_at: number | null;
  created_by_account_id: AccountId | null;
  id: OrganizationServiceTokenId | null;
  label: string | null;
  last_used_at: number | null;
  membership_disabled_at: number | null;
  membership_role: OrganizationMemberRole;
  organization_id: OrganizationId | null;
  revoked_at: number | null;
}

interface OrganizationServiceTokenCreateAdmissionRow {
  agent_id: AgentId | null;
  membership_disabled_at: number | null;
  membership_role: OrganizationMemberRole;
}

function normalizeTokenLabel(label: string): string {
  const normalized = label.trim();

  if (!normalized) {
    throw validationError("Token label is required.");
  }

  if (normalized.length > MAX_LABEL_LENGTH) {
    throw validationError(`Token label must be ${MAX_LABEL_LENGTH} characters or fewer.`);
  }

  return normalized;
}

function normalizeAllowedAgentIds(agentIds: readonly AgentId[]): AgentId[] {
  const unique = [...new Set(agentIds)];

  if (unique.length === 0) {
    throw validationError("Select at least one Agent for this Service token.");
  }

  if (unique.length > MAX_ALLOWED_AGENT_IDS) {
    throw validationError(`Select ${MAX_ALLOWED_AGENT_IDS} Agents or fewer.`);
  }

  return unique;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function createServiceTokenValue(): string {
  const bytes = new Uint8Array(TOKEN_SECRET_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return `${TOKEN_VALUE_PREFIX}${encodeBase64Url(bytes)}`;
}

export function isOrganizationServiceTokenValue(tokenValue: string): boolean {
  return tokenValue.startsWith(TOKEN_VALUE_PREFIX);
}

async function admitOrganizationServiceTokenCreate(input: {
  agentIds: readonly AgentId[];
  database: D1Database;
  organizationId: OrganizationId;
  viewerId: AccountId;
}): Promise<void> {
  const rows = await getAppDatabase(input.database)
    .select({
      agent_id: agentsTable.id,
      membership_disabled_at: organizationMembersTable.disabledAt,
      membership_role: organizationMembersTable.role,
    })
    .from(organizationMembersTable)
    .innerJoin(
      organizationsTable,
      eq(organizationsTable.id, organizationMembersTable.organizationId),
    )
    .leftJoin(
      agentsTable,
      and(
        eq(agentsTable.organizationId, organizationMembersTable.organizationId),
        eq(agentsTable.status, "published"),
        inArray(agentsTable.id, input.agentIds),
      ),
    )
    .where(
      and(
        eq(organizationMembersTable.accountId, input.viewerId),
        eq(organizationMembersTable.organizationId, input.organizationId),
      ),
    )
    .all();
  const firstRow = rows[0] satisfies OrganizationServiceTokenCreateAdmissionRow | undefined;

  if (firstRow === undefined) {
    throw new Error("Organization not found.");
  }

  if (firstRow.membership_disabled_at !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  if (!can(firstRow.membership_role, Permission.OrganizationServiceTokensManage)) {
    throw forbiddenError();
  }

  const found = new Set(rows.flatMap((row) => (row.agent_id === null ? [] : [row.agent_id])));
  const missing = input.agentIds.find((agentId) => !found.has(agentId));

  if (missing !== undefined) {
    throw validationError("Allowed agents must belong to the organization and be published.");
  }
}

function toTokenSummary(
  row: OrganizationServiceTokenListRow,
  allowedAgentIds: AgentId[],
): OrganizationServiceTokenSummary {
  return {
    allowAttribution: row.allow_attribution,
    allowedAgentIds,
    createdAt: toIsoString(row.created_at),
    createdByAccountId: row.created_by_account_id,
    id: row.id,
    label: row.label,
    lastUsedAt: row.last_used_at === null ? null : toIsoString(row.last_used_at),
    organizationId: row.organization_id,
    revokedAt: row.revoked_at === null ? null : toIsoString(row.revoked_at),
  };
}

function toTokenSummaries(
  rows: OrganizationServiceTokenListAdmissionRow[],
): OrganizationServiceTokenSummary[] {
  const tokenRows: OrganizationServiceTokenListRow[] = [];
  const allowedAgentIdsByTokenId = new Map<OrganizationServiceTokenId, AgentId[]>();

  for (const row of rows) {
    if (row.id === null) {
      continue;
    }

    let allowedAgentIds = allowedAgentIdsByTokenId.get(row.id);

    if (allowedAgentIds === undefined) {
      allowedAgentIds = [];
      allowedAgentIdsByTokenId.set(row.id, allowedAgentIds);
      tokenRows.push({
        allow_attribution: requireTokenListValue(row.allow_attribution),
        created_at: requireTokenListValue(row.created_at),
        created_by_account_id: requireTokenListValue(row.created_by_account_id),
        id: row.id,
        label: requireTokenListValue(row.label),
        last_used_at: row.last_used_at,
        organization_id: requireTokenListValue(row.organization_id),
        revoked_at: row.revoked_at,
      });
    }

    if (row.allowed_agent_id !== null) {
      allowedAgentIds.push(row.allowed_agent_id);
    }
  }

  return tokenRows.map((row) => toTokenSummary(row, allowedAgentIdsByTokenId.get(row.id) ?? []));
}

function requireTokenListValue<T>(value: T | null): T {
  if (value === null) {
    throw new Error("Service token list row is incomplete.");
  }

  return value;
}

async function admitOrganizationServiceTokenRevocation(
  database: D1Database,
  viewerId: AccountId,
  tokenId: OrganizationServiceTokenId,
): Promise<void> {
  const row =
    (await getAppDatabase(database)
      .select({
        membership_disabled_at: organizationMembersTable.disabledAt,
        membership_role: organizationMembersTable.role,
      })
      .from(organizationServiceTokensTable)
      .leftJoin(
        organizationMembersTable,
        and(
          eq(
            organizationMembersTable.organizationId,
            organizationServiceTokensTable.organizationId,
          ),
          eq(organizationMembersTable.accountId, viewerId),
        ),
      )
      .where(eq(organizationServiceTokensTable.id, tokenId))
      .limit(1)
      .get()) ?? null;

  const admission = row satisfies {
    membership_disabled_at: number | null;
    membership_role: OrganizationMemberRole | null;
  } | null;

  if (!admission) {
    throw forbiddenError("Service token not found.");
  }

  if (admission.membership_role === null) {
    throw new Error("Organization not found.");
  }

  if (admission.membership_disabled_at !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  if (!can(admission.membership_role, Permission.OrganizationServiceTokensManage)) {
    throw forbiddenError();
  }
}

export async function listOrganizationServiceTokens(
  database: D1Database,
  viewer: AuthenticatedViewer,
  organizationId: OrganizationId,
): Promise<OrganizationServiceTokenListResponse> {
  const rows = await getAppDatabase(database)
    .select({
      allow_attribution: organizationServiceTokensTable.allowAttribution,
      created_at: sql<number | null>`${organizationServiceTokensTable.createdAt}`,
      created_by_account_id: organizationServiceTokensTable.createdByAccountId,
      id: organizationServiceTokensTable.id,
      label: organizationServiceTokensTable.label,
      last_used_at: sql<number | null>`${organizationServiceTokensTable.lastUsedAt}`,
      membership_disabled_at: organizationMembersTable.disabledAt,
      membership_role: organizationMembersTable.role,
      organization_id: organizationServiceTokensTable.organizationId,
      revoked_at: sql<number | null>`${organizationServiceTokensTable.revokedAt}`,
      allowed_agent_id: organizationServiceTokenAgentsTable.agentId,
    })
    .from(organizationMembersTable)
    .innerJoin(
      organizationsTable,
      eq(organizationsTable.id, organizationMembersTable.organizationId),
    )
    .leftJoin(
      organizationServiceTokensTable,
      eq(organizationServiceTokensTable.organizationId, organizationMembersTable.organizationId),
    )
    .leftJoin(
      organizationServiceTokenAgentsTable,
      and(
        eq(organizationServiceTokenAgentsTable.tokenId, organizationServiceTokensTable.id),
        eq(
          organizationServiceTokenAgentsTable.organizationId,
          organizationServiceTokensTable.organizationId,
        ),
      ),
    )
    .where(
      and(
        eq(organizationMembersTable.accountId, viewer.id),
        eq(organizationMembersTable.organizationId, organizationId),
      ),
    )
    .orderBy(
      desc(organizationServiceTokensTable.createdAt),
      asc(organizationServiceTokenAgentsTable.agentId),
    )
    .all();
  const firstRow = rows[0];

  if (firstRow === undefined) {
    throw new Error("Organization not found.");
  }

  if (firstRow.membership_disabled_at !== null) {
    throw forbiddenError("Your organization membership is disabled.");
  }

  if (!can(firstRow.membership_role, Permission.OrganizationServiceTokensManage)) {
    throw forbiddenError();
  }
  return {
    tokens: toTokenSummaries(rows),
  };
}

export async function createOrganizationServiceToken(
  database: D1Database,
  viewer: AuthenticatedViewer,
  input: CreateOrganizationServiceTokenRequest,
): Promise<CreateOrganizationServiceTokenResponse> {
  const label = normalizeTokenLabel(input.label);
  const allowedAgentIds = normalizeAllowedAgentIds(input.allowedAgentIds);
  await admitOrganizationServiceTokenCreate({
    agentIds: allowedAgentIds,
    database,
    organizationId: input.organizationId,
    viewerId: viewer.id,
  });

  const timestampMs = currentTimestampMs();
  const tokenId = createPlatformId<OrganizationServiceTokenId>();
  const tokenValue = createServiceTokenValue();
  const tokenHash = await hashTokenValue(tokenValue);
  const db = getAppDatabase(database);

  await db
    .insert(organizationServiceTokensTable)
    .values({
      allowAttribution: input.allowAttribution,
      createdAt: sql`${timestampMs}`,
      createdByAccountId: viewer.id,
      id: tokenId,
      label,
      lastUsedAt: null,
      organizationId: input.organizationId,
      revokedAt: null,
      tokenHash,
      updatedAt: sql`${timestampMs}`,
    })
    .run();

  await db
    .insert(organizationServiceTokenAgentsTable)
    .values(
      allowedAgentIds.map((agentId) => ({
        agentId,
        createdAt: sql`${timestampMs}`,
        organizationId: input.organizationId,
        tokenId,
      })),
    )
    .run();

  return {
    token: {
      allowAttribution: input.allowAttribution,
      allowedAgentIds,
      createdAt: toIsoString(timestampMs),
      createdByAccountId: viewer.id,
      id: tokenId,
      label,
      lastUsedAt: null,
      organizationId: input.organizationId,
      revokedAt: null,
    },
    value: tokenValue,
  };
}

export async function revokeOrganizationServiceToken(
  database: D1Database,
  viewer: AuthenticatedViewer,
  tokenId: OrganizationServiceTokenId,
): Promise<void> {
  const db = getAppDatabase(database);
  await admitOrganizationServiceTokenRevocation(database, viewer.id, tokenId);
  const timestampMs = currentTimestampMs();

  await db
    .update(organizationServiceTokensTable)
    .set({
      revokedAt: sql`COALESCE(${organizationServiceTokensTable.revokedAt}, ${timestampMs})`,
      updatedAt: sql`${timestampMs}`,
    })
    .where(eq(organizationServiceTokensTable.id, tokenId))
    .run();
}
