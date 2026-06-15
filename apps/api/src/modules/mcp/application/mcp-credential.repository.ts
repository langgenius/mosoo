import type { McpCredentialRecordScope } from "@mosoo/contracts/mcp";
import { mcpCredentialsTable, mcpServersTable } from "@mosoo/db";
import type { AccountId, AgentId, AgentMcpBindingId, CredentialId, McpServerId } from "@mosoo/id";
import { and, eq, inArray, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { currentTimestampMs } from "../../../time";
import {
  deleteMcpCredentialSecret,
  replaceMcpCredentialSecret,
} from "./mcp-credential-secret-resolution";
import { createCredentialId } from "./mcp-platform-ids";
import type { AgentBindingRow, CredentialRow, ServerRow } from "./mcp-types";

interface McpCredentialResolutionBinding {
  agentCredentialId: CredentialId | null;
  agentId: AgentId;
  credentialMode: AgentBindingRow["credentialMode"];
  credentialScope: AgentBindingRow["credentialScope"];
  serverId: McpServerId;
}

const credentialColumns = {
  agentId: mcpCredentialsTable.agentId,
  authType: mcpCredentialsTable.authType,
  createdAt: mcpCredentialsTable.createdAt,
  expiresAt: mcpCredentialsTable.expiresAt,
  id: mcpCredentialsTable.id,
  lastRefreshedAt: mcpCredentialsTable.lastRefreshedAt,
  oauthClientId: mcpCredentialsTable.oauthClientId,
  oauthClientSecretSecretId: mcpCredentialsTable.oauthClientSecretSecretId,
  appId: mcpCredentialsTable.appId,
  refreshSecretId: mcpCredentialsTable.refreshSecretId,
  scope: mcpCredentialsTable.scope,
  scopeValuesJson: mcpCredentialsTable.scopeValuesJson,
  secretId: mcpCredentialsTable.secretId,
  serverId: mcpCredentialsTable.serverId,
  status: mcpCredentialsTable.status,
  subjectLabel: mcpCredentialsTable.subjectLabel,
  updatedAt: mcpCredentialsTable.updatedAt,
  userId: mcpCredentialsTable.accountId,
};

const credentialSecretServerColumns = {
  credentialScope: mcpServersTable.credentialScope,
  id: mcpServersTable.id,
  appId: mcpServersTable.appId,
};

function scopedCredentialKey(input: { agentId: AgentId | null; serverId: McpServerId }): string {
  return `${input.serverId}:${input.agentId ?? ""}`;
}

function credentialMatchesExplicitAgentBinding(
  credential: CredentialRow | null | undefined,
  binding: McpCredentialResolutionBinding,
): credential is CredentialRow {
  return (
    credential !== null &&
    credential !== undefined &&
    credential.scope === "agent" &&
    credential.agentId === binding.agentId &&
    credential.serverId === binding.serverId
  );
}

export async function getAppCredentialRow(
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

export async function getCredentialById(
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

export async function hasAppCredential(
  database: D1Database,
  serverId: McpServerId,
): Promise<boolean> {
  return (await listServerIdsWithAppCredentials(database, [serverId])).has(serverId);
}

export async function listServerIdsWithAppCredentials(
  database: D1Database,
  serverIds: McpServerId[],
): Promise<Set<McpServerId>> {
  const uniqueServerIds = [...new Set(serverIds)];

  if (uniqueServerIds.length === 0) {
    return new Set();
  }

  const rows = await getAppDatabase(database)
    .select({ serverId: mcpCredentialsTable.serverId })
    .from(mcpCredentialsTable)
    .where(
      and(
        inArray(mcpCredentialsTable.serverId, uniqueServerIds),
        eq(mcpCredentialsTable.scope, "app"),
        eq(mcpCredentialsTable.status, "active"),
      ),
    )
    .all();

  return new Set(rows.map((row) => row.serverId));
}

export async function resolveRegistryCredential(
  database: D1Database,
  server: ServerRow,
): Promise<CredentialRow | null> {
  return getAppCredentialRow(database, server.id);
}

export async function listCredentialsForAgentBindings(
  database: D1Database,
  bindings: AgentBindingRow[],
): Promise<Map<AgentMcpBindingId, CredentialRow | null>> {
  const credentials = await resolveCredentialsForMcpBindings(database, bindings);

  return new Map(bindings.map((binding, index) => [binding.id, credentials[index] ?? null]));
}

export async function resolveCredentialsForMcpBindings(
  database: D1Database,
  bindings: readonly McpCredentialResolutionBinding[],
): Promise<(CredentialRow | null)[]> {
  const resolvedCredentials = bindings.map(() => null as CredentialRow | null);

  const credentialIds = [
    ...new Set(
      bindings
        .filter((binding) => binding.credentialMode === "agent_bound")
        .map((binding) => binding.agentCredentialId)
        .filter((credentialId): credentialId is CredentialId => isTruthy(credentialId)),
    ),
  ];
  const agentScopedBindings = bindings.filter(
    (binding) => binding.credentialMode === "agent_bound" && !isTruthy(binding.agentCredentialId),
  );
  const appCredentialServerIds = [
    ...new Set(
      bindings
        .filter(
          (binding) =>
            binding.credentialMode === "runtime_resolved" && binding.credentialScope === "app",
        )
        .map((binding) => binding.serverId),
    ),
  ];
  const conditions: SQL[] = [];

  if (credentialIds.length > 0) {
    conditions.push(inArray(mcpCredentialsTable.id, credentialIds));
  }

  if (agentScopedBindings.length > 0) {
    const agentIds = [...new Set(agentScopedBindings.map((binding) => binding.agentId))];
    const serverIds = [...new Set(agentScopedBindings.map((binding) => binding.serverId))];
    const condition = and(
      eq(mcpCredentialsTable.scope, "agent"),
      inArray(mcpCredentialsTable.agentId, agentIds),
      inArray(mcpCredentialsTable.serverId, serverIds),
    );

    if (condition) {
      conditions.push(condition);
    }
  }

  if (appCredentialServerIds.length > 0) {
    const condition = and(
      eq(mcpCredentialsTable.scope, "app"),
      inArray(mcpCredentialsTable.serverId, appCredentialServerIds),
    );

    if (condition) {
      conditions.push(condition);
    }
  }

  const condition = conditions.length === 1 ? conditions[0] : or(...conditions);

  if (!condition) {
    return resolvedCredentials;
  }

  const credentials = await getAppDatabase(database)
    .select(credentialColumns)
    .from(mcpCredentialsTable)
    .where(condition)
    .all();
  const credentialsById = new Map(credentials.map((credential) => [credential.id, credential]));
  const agentCredentialsByKey = new Map(
    credentials
      .filter((credential) => credential.scope === "agent")
      .map((credential) => [scopedCredentialKey(credential), credential]),
  );
  const appCredentialsByServerId = new Map(
    credentials
      .filter((credential) => credential.scope === "app")
      .map((credential) => [credential.serverId, credential]),
  );

  bindings.forEach((binding, index) => {
    if (binding.credentialMode === "agent_bound") {
      if (isTruthy(binding.agentCredentialId)) {
        const credential = credentialsById.get(binding.agentCredentialId);
        resolvedCredentials[index] = credentialMatchesExplicitAgentBinding(credential, binding)
          ? credential
          : null;
        return;
      }

      resolvedCredentials[index] = agentCredentialsByKey.get(scopedCredentialKey(binding)) ?? null;
      return;
    }

    resolvedCredentials[index] = appCredentialsByServerId.get(binding.serverId) ?? null;
  });

  return resolvedCredentials;
}

export async function writeCredential(
  database: D1Database,
  bindings: ApiBindings,
  input: {
    accessToken: string;
    agentId?: AgentId | null;
    authType: "oauth" | "bearer";
    credentialId?: CredentialId | null;
    oauthClientId?: string | null;
    oauthClientSecret?: string | null;
    oauthClientSecretSecretId?: string | null;
    refreshToken?: string | null;
    scope: McpCredentialRecordScope;
    scopeValues: string[];
    server: Pick<ServerRow, "credentialScope" | "id" | "appId">;
    subjectLabel?: string | null;
    tokenExpiresAt?: number | null;
    userId?: AccountId | null;
  },
): Promise<CredentialRow> {
  const existing =
    input.credentialId === undefined || input.credentialId === null
      ? null
      : await getCredentialById(database, input.credentialId).catch(() => null);
  const id = existing?.id ?? createCredentialId();
  const createdAt = existing?.createdAt ?? currentTimestampMs();
  const updatedAt = currentTimestampMs();
  const secretOwner = {
    agentId: input.agentId ?? null,
    credentialId: id,
    scope: input.scope,
    server: input.server,
    userId: input.userId ?? null,
  };
  const accessSecretId = await replaceMcpCredentialSecret(bindings, {
    ...secretOwner,
    currentSecretId: existing?.secretId,
    purpose: "credential_access_token",
    secretKind: "access_token",
    value: input.accessToken,
  });
  const refreshSecretId =
    input.authType === "oauth"
      ? await replaceMcpCredentialSecret(bindings, {
          ...secretOwner,
          currentSecretId: existing?.refreshSecretId,
          purpose: "credential_refresh_token",
          secretKind: "refresh_token",
          value: input.refreshToken ?? null,
        })
      : null;
  const oauthClientSecretSecretId =
    input.authType === "oauth"
      ? input.oauthClientSecret !== undefined
        ? await replaceMcpCredentialSecret(bindings, {
            ...secretOwner,
            currentSecretId: existing?.oauthClientSecretSecretId,
            purpose: "credential_oauth_client_secret",
            secretKind: "oauth_client_secret",
            value: input.oauthClientSecret ?? null,
          })
        : (input.oauthClientSecretSecretId ?? existing?.oauthClientSecretSecretId ?? null)
      : null;

  if (!isTruthy(accessSecretId)) {
    throw new Error("Access token is required.");
  }

  const credentialValues = {
    accountId: input.userId ?? null,
    agentId: input.agentId ?? null,
    authType: input.authType,
    createdAt,
    expiresAt: input.tokenExpiresAt ?? null,
    id,
    lastRefreshedAt: input.authType === "oauth" ? updatedAt : null,
    oauthClientId: input.oauthClientId ?? existing?.oauthClientId ?? null,
    oauthClientSecretSecretId,
    appId: input.server.appId,
    refreshSecretId,
    scope: input.scope,
    scopeValuesJson: JSON.stringify(input.scopeValues),
    secretId: accessSecretId,
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

export async function expireCredential(
  database: D1Database,
  credentialId: CredentialId,
): Promise<void> {
  await getAppDatabase(database)
    .update(mcpCredentialsTable)
    .set({ status: "expired", updatedAt: currentTimestampMs() })
    .where(eq(mcpCredentialsTable.id, credentialId))
    .run();
}

export async function deleteCredentialArtifactsBatch(
  database: D1Database,
  credentials: readonly (CredentialRow | null | undefined)[],
): Promise<void> {
  const credentialRows = credentials.filter(
    (credential): credential is CredentialRow => credential !== null && credential !== undefined,
  );
  const credentialIds = [...new Set(credentialRows.map((credential) => credential.id))];

  if (credentialIds.length === 0) {
    return;
  }

  const serverRows = await getAppDatabase(database)
    .select(credentialSecretServerColumns)
    .from(mcpServersTable)
    .where(inArray(mcpServersTable.id, [...new Set(credentialRows.map((row) => row.serverId))]))
    .all();
  const serversById = new Map(serverRows.map((server) => [server.id, server]));

  for (const credential of credentialRows) {
    const server = serversById.get(credential.serverId);

    if (!server) {
      throw new Error("MCP credential server not found.");
    }

    const owner = {
      agentId: credential.agentId,
      credentialId: credential.id,
      scope: credential.scope,
      server,
      userId: credential.userId,
    };
    const outcomes = await Promise.all([
      deleteMcpCredentialSecret(database, {
        ...owner,
        purpose: "credential_artifact_cleanup",
        secretId: credential.secretId,
        secretKind: "access_token",
      }),
      deleteMcpCredentialSecret(database, {
        ...owner,
        purpose: "credential_artifact_cleanup",
        secretId: credential.refreshSecretId,
        secretKind: "refresh_token",
      }),
      deleteMcpCredentialSecret(database, {
        ...owner,
        purpose: "credential_artifact_cleanup",
        secretId: credential.oauthClientSecretSecretId,
        secretKind: "oauth_client_secret",
      }),
    ]);
    const denied = outcomes.find((outcome) => outcome.status === "denied");

    if (denied?.status === "denied") {
      throw new Error(`MCP credential secret cleanup denied: ${denied.reason}.`);
    }
  }

  await getAppDatabase(database)
    .delete(mcpCredentialsTable)
    .where(inArray(mcpCredentialsTable.id, credentialIds))
    .run();
}

export async function listCredentialsForAgentBindingDeletion(
  database: D1Database,
  input: {
    agentId: AgentId;
    bindings: readonly { agentCredentialId: CredentialId | null; serverId: McpServerId }[];
  },
): Promise<CredentialRow[]> {
  const explicitCredentialIds = [
    ...new Set(
      input.bindings
        .map((binding) => binding.agentCredentialId)
        .filter((credentialId): credentialId is CredentialId => isTruthy(credentialId)),
    ),
  ];
  const implicitAgentServerIds = [
    ...new Set(
      input.bindings
        .filter((binding) => !isTruthy(binding.agentCredentialId))
        .map((binding) => binding.serverId),
    ),
  ];
  const conditions: SQL[] = [];

  if (explicitCredentialIds.length > 0) {
    conditions.push(inArray(mcpCredentialsTable.id, explicitCredentialIds));
  }

  if (implicitAgentServerIds.length > 0) {
    const condition = and(
      eq(mcpCredentialsTable.scope, "agent"),
      eq(mcpCredentialsTable.agentId, input.agentId),
      inArray(mcpCredentialsTable.serverId, implicitAgentServerIds),
    );

    if (condition) {
      conditions.push(condition);
    }
  }

  const condition = conditions.length === 1 ? conditions[0] : or(...conditions);

  if (!condition) {
    return [];
  }

  return getAppDatabase(database)
    .select(credentialColumns)
    .from(mcpCredentialsTable)
    .where(condition)
    .all();
}
