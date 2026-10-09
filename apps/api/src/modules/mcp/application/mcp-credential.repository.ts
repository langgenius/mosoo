import { mcpCredentialsTable } from "@mosoo/db";
import { createPlatformId } from "@mosoo/id";
import type { CredentialId, McpServerId } from "@mosoo/id";
import { and, eq, inArray } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import { deleteSecret, storeSecret } from "../../vault/application/vault-secret-store";
import type { CredentialRow, ServerRow } from "./mcp-types";

const MCP_CREDENTIAL_SECRET_KIND = "mcp_credential";

export const credentialColumns = {
  authType: mcpCredentialsTable.authType,
  createdAt: mcpCredentialsTable.createdAt,
  expiresAt: mcpCredentialsTable.expiresAt,
  id: mcpCredentialsTable.id,
  oauthClientId: mcpCredentialsTable.oauthClientId,
  oauthClientSecretSecretId: mcpCredentialsTable.oauthClientSecretSecretId,
  projectId: mcpCredentialsTable.projectId,
  refreshSecretId: mcpCredentialsTable.refreshSecretId,
  scope: mcpCredentialsTable.scope,
  scopeValuesJson: mcpCredentialsTable.scopeValuesJson,
  secretId: mcpCredentialsTable.secretId,
  serverId: mcpCredentialsTable.serverId,
  status: mcpCredentialsTable.status,
  subjectLabel: mcpCredentialsTable.subjectLabel,
  updatedAt: mcpCredentialsTable.updatedAt,
};

export async function getProjectCredentialRow(
  database: D1Database,
  serverId: McpServerId,
): Promise<CredentialRow | null> {
  return (
    (await getAppDatabase(database)
      .select(credentialColumns)
      .from(mcpCredentialsTable)
      .where(and(eq(mcpCredentialsTable.serverId, serverId), eq(mcpCredentialsTable.scope, "app")))
      .limit(1)
      .get()) ?? null
  );
}

export async function listProjectCredentialRowsByServerId(
  database: D1Database,
  serverIds: readonly McpServerId[],
): Promise<Map<McpServerId, CredentialRow>> {
  const uniqueServerIds = [...new Set(serverIds)];

  if (uniqueServerIds.length === 0) {
    return new Map();
  }

  const rows = await getAppDatabase(database)
    .select(credentialColumns)
    .from(mcpCredentialsTable)
    .where(
      and(
        inArray(mcpCredentialsTable.serverId, uniqueServerIds),
        eq(mcpCredentialsTable.scope, "app"),
      ),
    )
    .all();

  return new Map(rows.map((row) => [row.serverId, row]));
}

async function getCredentialById(
  database: D1Database,
  credentialId: CredentialId,
): Promise<CredentialRow> {
  const row = await getCredentialByIdOrNull(database, credentialId);

  if (!row) {
    throw new Error("MCP credential not found.");
  }

  return row;
}

export async function getCredentialByIdOrNull(
  database: D1Database,
  credentialId: CredentialId,
): Promise<CredentialRow | null> {
  const row = await getAppDatabase(database)
    .select(credentialColumns)
    .from(mcpCredentialsTable)
    .where(eq(mcpCredentialsTable.id, credentialId))
    .limit(1)
    .get();

  return row ?? null;
}

export async function listCredentialRowsByServerId(
  database: D1Database,
  serverId: McpServerId,
): Promise<CredentialRow[]> {
  return getAppDatabase(database)
    .select(credentialColumns)
    .from(mcpCredentialsTable)
    .where(eq(mcpCredentialsTable.serverId, serverId))
    .all();
}

async function storeCredentialSecret(
  bindings: ApiBindings,
  value: string | null | undefined,
): Promise<string | null> {
  return isTruthy(value)
    ? storeSecret(bindings.DB, bindings, { kind: MCP_CREDENTIAL_SECRET_KIND, value })
    : null;
}

async function deleteCredentialSecrets(
  database: D1Database,
  credentials: readonly CredentialRow[],
): Promise<void> {
  await Promise.all(
    credentials
      .flatMap((credential) => [
        credential.secretId,
        credential.refreshSecretId,
        credential.oauthClientSecretSecretId,
      ])
      .map(async (secretId) => deleteSecret(database, secretId)),
  );
}

export async function writeCredential(
  database: D1Database,
  bindings: ApiBindings,
  input: {
    accessToken: string;
    authType: "oauth" | "bearer";
    credentialId: CredentialId | null;
    oauthClientId?: string | null;
    oauthClientSecret?: string | null;
    refreshToken?: string | null;
    scopeValues: string[];
    server: Pick<ServerRow, "id" | "projectId">;
    subjectLabel?: string | null;
    tokenExpiresAt?: number | null;
  },
): Promise<CredentialRow> {
  if (!isTruthy(input.accessToken)) {
    throw new Error("Access token is required.");
  }

  const existing =
    input.credentialId === null ? null : await getCredentialById(database, input.credentialId);
  const id = existing?.id ?? createPlatformId<CredentialId>();
  const updatedAt = currentTimestampMs();
  const isOAuth = input.authType === "oauth";
  const [secretId, refreshSecretId, oauthClientSecretSecretId] = await Promise.all([
    storeSecret(bindings.DB, bindings, {
      kind: MCP_CREDENTIAL_SECRET_KIND,
      value: input.accessToken,
    }),
    storeCredentialSecret(bindings, isOAuth ? input.refreshToken : null),
    storeCredentialSecret(bindings, isOAuth ? input.oauthClientSecret : null),
  ]);
  const credentialValues = {
    authType: input.authType,
    createdAt: existing?.createdAt ?? updatedAt,
    expiresAt: input.tokenExpiresAt ?? null,
    id,
    lastRefreshedAt: isOAuth ? updatedAt : null,
    oauthClientId: input.oauthClientId ?? existing?.oauthClientId ?? null,
    oauthClientSecretSecretId,
    projectId: input.server.projectId,
    refreshSecretId,
    scope: "app" as const,
    scopeValuesJson: JSON.stringify(input.scopeValues),
    secretId,
    serverId: input.server.id,
    status: "active" as const,
    subjectLabel: input.subjectLabel ?? null,
    updatedAt,
  };

  await getAppDatabase(database)
    .insert(mcpCredentialsTable)
    .values(credentialValues)
    .onConflictDoUpdate({
      set: credentialValues,
      target: mcpCredentialsTable.id,
    })
    .run();

  if (existing) {
    await deleteCredentialSecrets(database, [existing]);
  }

  return getCredentialById(database, id);
}

export async function revokeCredential(
  database: D1Database,
  credential: CredentialRow | null,
): Promise<void> {
  if (!credential) {
    return;
  }

  await getAppDatabase(database)
    .update(mcpCredentialsTable)
    .set({ status: "revoked", updatedAt: currentTimestampMs() })
    .where(eq(mcpCredentialsTable.id, credential.id))
    .run();
}

export async function deleteCredentialArtifactsBatch(
  database: D1Database,
  credentials: readonly CredentialRow[],
): Promise<void> {
  if (credentials.length === 0) {
    return;
  }

  // Secrets go first: if one delete fails, the rows still reference it.
  await deleteCredentialSecrets(database, credentials);
  await getAppDatabase(database)
    .delete(mcpCredentialsTable)
    .where(
      inArray(
        mcpCredentialsTable.id,
        credentials.map((credential) => credential.id),
      ),
    )
    .run();
}
