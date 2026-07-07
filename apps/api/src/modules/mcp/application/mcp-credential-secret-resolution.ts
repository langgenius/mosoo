import { vaultSecretsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, AgentId, CredentialId, McpServerId, AppId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import {
  deleteSecret,
  readSecretOutcome,
  storeSecret,
} from "../../vault/application/vault-secret-store";
import type { CredentialRow, ServerRow } from "./mcp-types";

export type McpCredentialSecretReadPurpose =
  | "runtime_access_token"
  | "runtime_oauth_client_secret"
  | "runtime_refresh_token";

export type McpCredentialSecretReadDenialReason =
  | "credential_auth_type_mismatch"
  | "credential_scope_mismatch"
  | "credential_scope_owner_mismatch"
  | "credential_secret_missing"
  | "credential_server_mismatch"
  | "secret_kind_mismatch"
  | "secret_not_found"
  | "server_app_mismatch";

export type McpCredentialSecretStorageKind =
  | "access_token"
  | "oauth_client_secret"
  | "refresh_token";

export type McpCredentialSecretWritePurpose =
  | "credential_access_token"
  | "credential_oauth_client_secret"
  | "credential_refresh_token";

export type McpCredentialSecretDeletePurpose =
  | "credential_artifact_cleanup"
  | "credential_replace"
  | "credential_revoke";

type McpCredentialSecretOwnerServer = Pick<ServerRow, "credentialScope" | "id" | "appId">;

interface McpCredentialSecretOwner {
  agentId: AgentId | null;
  credentialId: CredentialId;
  scope: CredentialRow["scope"];
  server: McpCredentialSecretOwnerServer;
  userId: AccountId | null;
}

export interface ReplaceMcpCredentialSecretCommand extends McpCredentialSecretOwner {
  currentSecretId: string | null | undefined;
  purpose: McpCredentialSecretWritePurpose;
  secretKind: McpCredentialSecretStorageKind;
  value: string | null | undefined;
}

export interface DeleteMcpCredentialSecretCommand extends McpCredentialSecretOwner {
  purpose: McpCredentialSecretDeletePurpose;
  secretId: string | null | undefined;
  secretKind: McpCredentialSecretStorageKind;
}

export type McpCredentialSecretDeleteOutcome =
  | {
      status: "deleted" | "skipped";
    }
  | {
      credentialId: CredentialId;
      purpose: McpCredentialSecretDeletePurpose;
      reason:
        | "credential_scope_mismatch"
        | "credential_scope_owner_mismatch"
        | "secret_kind_mismatch"
        | "secret_not_found";
      secretKind: McpCredentialSecretStorageKind;
      serverId: McpServerId;
      status: "denied";
    };

export interface ReadMcpCredentialSecretCommand {
  credential: CredentialRow;
  purpose: McpCredentialSecretReadPurpose;
  appId: AppId;
  server: ServerRow;
}

export type McpCredentialSecretReadOutcome =
  | {
      status: "allowed";
      value: string;
    }
  | {
      credentialId: string;
      purpose: McpCredentialSecretReadPurpose;
      reason: McpCredentialSecretReadDenialReason;
      serverId: string;
      status: "denied";
    };

function getCredentialSecretId(command: ReadMcpCredentialSecretCommand): string | null {
  if (command.purpose === "runtime_access_token") {
    return command.credential.secretId;
  }

  if (command.credential.authType !== "oauth") {
    return null;
  }

  return command.purpose === "runtime_refresh_token"
    ? command.credential.refreshSecretId
    : command.credential.oauthClientSecretSecretId;
}

function credentialScopeHasOwner(input: {
  agentId: AgentId | null;
  scope: CredentialRow["scope"];
  userId: AccountId | null;
}): boolean {
  if (input.scope === "app") {
    return input.agentId === null && input.userId === null;
  }

  return input.userId === null && isTruthy(input.agentId);
}

function getMcpCredentialOwnerDenial(
  owner: McpCredentialSecretOwner,
): "credential_scope_mismatch" | "credential_scope_owner_mismatch" | null {
  if (owner.scope !== "agent" && owner.scope !== owner.server.credentialScope) {
    return "credential_scope_mismatch";
  }

  if (!credentialScopeHasOwner(owner)) {
    return "credential_scope_owner_mismatch";
  }

  return null;
}

function getMcpCredentialOwnerKey(owner: McpCredentialSecretOwner): string {
  if (owner.scope === "app") {
    return "app";
  }

  return owner.agentId ?? "";
}

function toMcpCredentialSecretStorageKind(input: {
  owner: McpCredentialSecretOwner;
  secretKind: McpCredentialSecretStorageKind;
}): string {
  const denial = getMcpCredentialOwnerDenial(input.owner);

  if (denial !== null) {
    throw new Error(`MCP credential secret owner is invalid: ${denial}.`);
  }

  return [
    "mcp_credential",
    input.owner.server.appId,
    input.owner.server.id,
    input.owner.scope,
    getMcpCredentialOwnerKey(input.owner),
    input.owner.credentialId,
    input.secretKind,
  ].join(":");
}

async function readVaultSecretKind(database: D1Database, secretId: string): Promise<string | null> {
  const row = await getAppDatabase(database)
    .select({ kind: vaultSecretsTable.kind })
    .from(vaultSecretsTable)
    .where(eq(vaultSecretsTable.id, parsePlatformId(secretId, "secretId")))
    .limit(1)
    .get();

  return row?.kind ?? null;
}

function getMcpCredentialSecretReadDenial(
  command: ReadMcpCredentialSecretCommand,
): McpCredentialSecretReadDenialReason | null {
  if (command.server.appId !== command.appId) {
    return "server_app_mismatch";
  }

  if (command.credential.serverId !== command.server.id) {
    return "credential_server_mismatch";
  }

  if (
    command.credential.scope !== "agent" &&
    command.credential.scope !== command.server.credentialScope
  ) {
    return "credential_scope_mismatch";
  }

  if (!credentialScopeHasOwner(command.credential)) {
    return "credential_scope_owner_mismatch";
  }

  if (command.purpose !== "runtime_access_token" && command.credential.authType !== "oauth") {
    return "credential_auth_type_mismatch";
  }

  if (!isTruthy(getCredentialSecretId(command))) {
    return "credential_secret_missing";
  }

  return null;
}

function denyMcpCredentialSecretRead(
  command: ReadMcpCredentialSecretCommand,
  reason: McpCredentialSecretReadDenialReason,
): McpCredentialSecretReadOutcome {
  return {
    credentialId: command.credential.id,
    purpose: command.purpose,
    reason,
    serverId: command.server.id,
    status: "denied",
  };
}

function getMcpCredentialSecretReadKind(
  purpose: McpCredentialSecretReadPurpose,
): McpCredentialSecretStorageKind {
  if (purpose === "runtime_access_token") {
    return "access_token";
  }

  return purpose === "runtime_refresh_token" ? "refresh_token" : "oauth_client_secret";
}

export async function readMcpCredentialSecret(
  bindings: Pick<ApiBindings, "DB" | "VAULT_ROOT_SECRET">,
  command: ReadMcpCredentialSecretCommand,
): Promise<McpCredentialSecretReadOutcome> {
  const denial = getMcpCredentialSecretReadDenial(command);

  if (denial !== null) {
    return denyMcpCredentialSecretRead(command, denial);
  }

  const secretId = getCredentialSecretId(command);

  if (!isTruthy(secretId)) {
    return denyMcpCredentialSecretRead(command, "credential_secret_missing");
  }

  const expectedKind = toMcpCredentialSecretStorageKind({
    owner: {
      agentId: command.credential.agentId,
      credentialId: command.credential.id,
      scope: command.credential.scope,
      server: command.server,
      userId: command.credential.userId,
    },
    secretKind: getMcpCredentialSecretReadKind(command.purpose),
  });
  const actualKind = await readVaultSecretKind(bindings.DB, secretId);

  if (actualKind === null) {
    return denyMcpCredentialSecretRead(command, "secret_not_found");
  }

  if (actualKind !== expectedKind) {
    return denyMcpCredentialSecretRead(command, "secret_kind_mismatch");
  }

  const secret = await readSecretOutcome(bindings.DB, bindings, secretId);

  if (secret.status === "missing") {
    return denyMcpCredentialSecretRead(command, secret.reason);
  }

  return { status: "allowed", value: secret.value };
}

function denyMcpCredentialSecretDelete(
  command: DeleteMcpCredentialSecretCommand,
  reason:
    | "credential_scope_mismatch"
    | "credential_scope_owner_mismatch"
    | "secret_kind_mismatch"
    | "secret_not_found",
): McpCredentialSecretDeleteOutcome {
  return {
    credentialId: command.credentialId,
    purpose: command.purpose,
    reason,
    secretKind: command.secretKind,
    serverId: command.server.id,
    status: "denied",
  };
}

export async function deleteMcpCredentialSecret(
  database: D1Database,
  command: DeleteMcpCredentialSecretCommand,
): Promise<McpCredentialSecretDeleteOutcome> {
  if (!isTruthy(command.secretId)) {
    return { status: "skipped" };
  }

  const denial = getMcpCredentialOwnerDenial(command);

  if (denial !== null) {
    return denyMcpCredentialSecretDelete(command, denial);
  }

  const expectedKind = toMcpCredentialSecretStorageKind({
    owner: command,
    secretKind: command.secretKind,
  });
  const actualKind = await readVaultSecretKind(database, command.secretId);

  if (actualKind === null) {
    return denyMcpCredentialSecretDelete(command, "secret_not_found");
  }

  if (actualKind !== expectedKind) {
    return denyMcpCredentialSecretDelete(command, "secret_kind_mismatch");
  }

  await deleteSecret(database, command.secretId);
  return { status: "deleted" };
}

function ensureMcpCredentialSecretDeleted(outcome: McpCredentialSecretDeleteOutcome): void {
  if (outcome.status === "denied") {
    throw new Error(`MCP credential secret delete denied: ${outcome.reason}.`);
  }
}

export async function replaceMcpCredentialSecret(
  bindings: ApiBindings,
  command: ReplaceMcpCredentialSecretCommand,
): Promise<string | null> {
  if (!isTruthy(command.value)) {
    ensureMcpCredentialSecretDeleted(
      await deleteMcpCredentialSecret(bindings.DB, {
        ...command,
        purpose: "credential_replace",
        secretId: command.currentSecretId,
      }),
    );
    return null;
  }

  const nextSecretId = await storeSecret(bindings.DB, bindings, {
    kind: toMcpCredentialSecretStorageKind({
      owner: command,
      secretKind: command.secretKind,
    }),
    value: command.value,
  });

  try {
    ensureMcpCredentialSecretDeleted(
      await deleteMcpCredentialSecret(bindings.DB, {
        ...command,
        purpose: "credential_replace",
        secretId: command.currentSecretId,
      }),
    );
  } catch (error) {
    await deleteMcpCredentialSecret(bindings.DB, {
      ...command,
      purpose: "credential_replace",
      secretId: nextSecretId,
    }).catch(() => undefined);
    throw error;
  }

  return nextSecretId;
}
