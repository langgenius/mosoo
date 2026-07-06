import { vaultSecretsTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, PlatformId, AppId } from "@mosoo/id";
import { eq } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { isTruthy } from "../../../shared/truthiness";
import { deleteSecret, readSecretOutcome, storeSecret } from "../../vault/application/vault-secret-store";
import type { OAuthFlowRow, ServerRow } from "./mcp-types";

type McpOAuthSecretBindings = Pick<ApiBindings, "DB" | "VAULT_ROOT_SECRET">;

export type McpOAuthSecretReadPurpose =
  | "oauth_authorization_client_secret"
  | "oauth_callback_client_secret";

export type McpOAuthSecretDeletePurpose =
  | "oauth_flow_artifact_cleanup"
  | "oauth_flow_insert_cleanup"
  | "oauth_flow_terminal_cleanup"
  | "oauth_server_create_cleanup"
  | "oauth_server_delete_cleanup";

export type McpOAuthSecretStorageKind = "flow_client_secret" | "server_client_secret";

export type McpOAuthSecretReadDenialReason =
  | "flow_client_secret_missing"
  | "flow_initiator_mismatch"
  | "flow_app_mismatch"
  | "flow_server_mismatch"
  | "flow_status_mismatch"
  | "secret_kind_mismatch"
  | "secret_not_found"
  | "server_auth_type_mismatch"
  | "server_client_secret_missing"
  | "server_owner_mismatch"
  | "server_app_mismatch";

export type McpOAuthSecretWriteDenialReason =
  | "flow_initiator_mismatch"
  | "flow_app_mismatch"
  | "server_auth_type_mismatch"
  | "server_owner_mismatch"
  | "server_app_mismatch";

export type McpOAuthSecretDeleteDenialReason = "secret_kind_mismatch" | "secret_not_found";

export type McpOAuthSecretReadOutcome =
  | {
      status: "allowed";
      value: string;
    }
  | {
      purpose: McpOAuthSecretReadPurpose;
      reason: McpOAuthSecretReadDenialReason;
      serverId: string;
      status: "denied";
    };

export type McpOAuthSecretDeleteOutcome =
  | {
      status: "deleted" | "skipped";
    }
  | {
      purpose: McpOAuthSecretDeletePurpose;
      reason: McpOAuthSecretDeleteDenialReason;
      resourceId: string;
      secretKind: McpOAuthSecretStorageKind;
      status: "denied";
    };

export interface McpOAuthUserSecretActor {
  accountId: AccountId;
  type: "user";
}

export type McpOAuthSecretActor =
  | McpOAuthUserSecretActor
  | {
      name:
        | "mcp_oauth_flow_retention_cleanup"
        | "mcp_oauth_flow_terminal_cleanup"
        | "mcp_oauth_server_delete_cascade";
      type: "system";
    };

export interface ReadMcpOAuthServerClientSecretCommand {
  actor: McpOAuthUserSecretActor;
  purpose: "oauth_authorization_client_secret";
  appId: AppId;
  secretKind: "server_client_secret";
  server: ServerRow;
}

export interface ReadMcpOAuthFlowClientSecretCommand {
  actor: McpOAuthUserSecretActor;
  flow: OAuthFlowRow;
  purpose: "oauth_callback_client_secret";
  appId: AppId;
  secretKind: "flow_client_secret";
  server: ServerRow;
}

type McpOAuthServerSecretOwner = Pick<
  ServerRow,
  "authType" | "credentialScope" | "id" | "ownerId" | "appId" | "source"
>;

type McpOAuthFlowSecretOwner = Pick<OAuthFlowRow, "id" | "initiatorUserId" | "appId" | "serverId">;

export interface StoreMcpOAuthServerClientSecretCommand {
  actor: McpOAuthUserSecretActor;
  purpose: "oauth_server_create_client_secret";
  appId: AppId;
  secretKind: "server_client_secret";
  server: McpOAuthServerSecretOwner;
  value: string;
}

export interface StoreMcpOAuthFlowClientSecretCommand {
  actor: McpOAuthUserSecretActor;
  flow: McpOAuthFlowSecretOwner;
  purpose: "oauth_flow_start_client_secret";
  appId: AppId;
  secretKind: "flow_client_secret";
  value: string;
}

export interface DeleteMcpOAuthServerClientSecretCommand {
  actor: McpOAuthSecretActor;
  purpose: "oauth_server_create_cleanup" | "oauth_server_delete_cleanup";
  appId: AppId;
  secretId: PlatformId | string | null | undefined;
  secretKind: "server_client_secret";
  server: McpOAuthServerSecretOwner;
}

export interface DeleteMcpOAuthFlowClientSecretCommand {
  actor: McpOAuthSecretActor;
  flow: McpOAuthFlowSecretOwner;
  purpose:
    | "oauth_flow_artifact_cleanup"
    | "oauth_flow_insert_cleanup"
    | "oauth_flow_terminal_cleanup";
  appId: AppId;
  secretId: PlatformId | string | null | undefined;
  secretKind: "flow_client_secret";
}

function hasServerOAuthAccess(
  command: Pick<ReadMcpOAuthServerClientSecretCommand, "actor" | "appId" | "server">,
): McpOAuthSecretReadDenialReason | null {
  if (command.server.appId !== command.appId) {
    return "server_app_mismatch";
  }

  if (command.server.authType !== "oauth") {
    return "server_auth_type_mismatch";
  }

  if (command.server.ownerId !== command.actor.accountId) {
    return "server_owner_mismatch";
  }

  return null;
}

function hasServerOAuthWriteAccess(
  command: Pick<
    StoreMcpOAuthServerClientSecretCommand | DeleteMcpOAuthServerClientSecretCommand,
    "actor" | "appId" | "server"
  >,
): McpOAuthSecretWriteDenialReason | null {
  if (command.server.appId !== command.appId) {
    return "server_app_mismatch";
  }

  if (command.server.authType !== "oauth") {
    return "server_auth_type_mismatch";
  }

  if (command.actor.type !== "user") {
    return null;
  }

  return command.server.ownerId === command.actor.accountId ? null : "server_owner_mismatch";
}

function getFlowOAuthWriteDenial(
  command: Pick<StoreMcpOAuthFlowClientSecretCommand, "actor" | "flow" | "appId">,
): McpOAuthSecretWriteDenialReason | null {
  if (command.flow.appId !== command.appId) {
    return "flow_app_mismatch";
  }

  if (command.flow.initiatorUserId !== command.actor.accountId) {
    return "flow_initiator_mismatch";
  }

  return null;
}

function assertMcpOAuthServerSecretWriteAllowed(
  command: Pick<
    StoreMcpOAuthServerClientSecretCommand | DeleteMcpOAuthServerClientSecretCommand,
    "actor" | "appId" | "server"
  >,
): void {
  const denial = hasServerOAuthWriteAccess(command);

  if (denial !== null) {
    throw new Error(`MCP OAuth server client secret write denied: ${denial}.`);
  }
}

function assertMcpOAuthFlowSecretWriteAllowed(
  command: Pick<StoreMcpOAuthFlowClientSecretCommand, "actor" | "flow" | "appId">,
): void {
  const denial = getFlowOAuthWriteDenial(command);

  if (denial !== null) {
    throw new Error(`MCP OAuth flow client secret write denied: ${denial}.`);
  }
}

function denyOAuthSecretRead(
  command: { purpose: McpOAuthSecretReadPurpose; server: ServerRow },
  reason: McpOAuthSecretReadDenialReason,
): McpOAuthSecretReadOutcome {
  return {
    purpose: command.purpose,
    reason,
    serverId: command.server.id,
    status: "denied",
  };
}

function denyOAuthSecretDelete(
  command: {
    purpose: McpOAuthSecretDeletePurpose;
    resourceId: string;
    secretKind: McpOAuthSecretStorageKind;
  },
  reason: McpOAuthSecretDeleteDenialReason,
): McpOAuthSecretDeleteOutcome {
  return {
    purpose: command.purpose,
    reason,
    resourceId: command.resourceId,
    secretKind: command.secretKind,
    status: "denied",
  };
}

function toMcpOAuthServerClientSecretKind(input: {
  secretKind: "server_client_secret";
  server: McpOAuthServerSecretOwner;
}): string {
  return [
    "mcp_oauth",
    input.secretKind,
    input.server.appId,
    input.server.id,
    input.server.ownerId,
  ].join(":");
}

function toMcpOAuthFlowClientSecretKind(input: {
  flow: McpOAuthFlowSecretOwner;
  secretKind: "flow_client_secret";
}): string {
  return [
    "mcp_oauth",
    input.secretKind,
    input.flow.appId,
    input.flow.serverId,
    input.flow.id,
    input.flow.initiatorUserId,
  ].join(":");
}

async function readSecretWithExpectedKind(
  bindings: McpOAuthSecretBindings,
  input: {
    expectedKind: string;
    secretId: string;
  },
): Promise<
  | {
      status: "allowed";
      value: string;
    }
  | {
      reason: "secret_kind_mismatch" | "secret_not_found";
      status: "denied";
    }
> {
  const secretId = parsePlatformId(input.secretId, "secretId");
  const row =
    (await getAppDatabase(bindings.DB)
      .select({ kind: vaultSecretsTable.kind })
      .from(vaultSecretsTable)
      .where(eq(vaultSecretsTable.id, secretId))
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return { reason: "secret_not_found", status: "denied" };
  }

  if (row.kind !== input.expectedKind) {
    return { reason: "secret_kind_mismatch", status: "denied" };
  }

  const secret = await readSecretOutcome(bindings.DB, bindings, input.secretId);

  if (secret.status === "missing") {
    return { reason: secret.reason, status: "denied" };
  }

  return { status: "allowed", value: secret.value };
}

async function readSecretKind(
  database: D1Database,
  secretId: PlatformId | string,
): Promise<string | null> {
  const row =
    (await getAppDatabase(database)
      .select({ kind: vaultSecretsTable.kind })
      .from(vaultSecretsTable)
      .where(eq(vaultSecretsTable.id, parsePlatformId(secretId, "secretId")))
      .limit(1)
      .get()) ?? null;

  return row?.kind ?? null;
}

function actorLogContext(actor: McpOAuthSecretActor): Record<string, unknown> {
  return actor.type === "user"
    ? {
        actorAccountId: actor.accountId,
        actorType: actor.type,
      }
    : {
        actorName: actor.name,
        actorType: actor.type,
      };
}

export async function storeMcpOAuthServerClientSecret(
  bindings: ApiBindings,
  command: StoreMcpOAuthServerClientSecretCommand,
): Promise<PlatformId> {
  assertMcpOAuthServerSecretWriteAllowed(command);

  return storeSecret(bindings.DB, bindings, {
    kind: toMcpOAuthServerClientSecretKind(command),
    value: command.value,
  });
}

export async function storeMcpOAuthFlowClientSecret(
  bindings: ApiBindings,
  command: StoreMcpOAuthFlowClientSecretCommand,
): Promise<PlatformId> {
  assertMcpOAuthFlowSecretWriteAllowed(command);

  return storeSecret(bindings.DB, bindings, {
    kind: toMcpOAuthFlowClientSecretKind(command),
    value: command.value,
  });
}

export async function deleteMcpOAuthServerClientSecret(
  database: D1Database,
  command: DeleteMcpOAuthServerClientSecretCommand,
): Promise<McpOAuthSecretDeleteOutcome> {
  if (!isTruthy(command.secretId)) {
    return { status: "skipped" };
  }

  assertMcpOAuthServerSecretWriteAllowed(command);

  const expectedKind = toMcpOAuthServerClientSecretKind(command);
  const actualKind = await readSecretKind(database, command.secretId);

  if (actualKind === null) {
    return denyOAuthSecretDelete(
      { purpose: command.purpose, resourceId: command.server.id, secretKind: command.secretKind },
      "secret_not_found",
    );
  }

  if (actualKind !== expectedKind) {
    return denyOAuthSecretDelete(
      { purpose: command.purpose, resourceId: command.server.id, secretKind: command.secretKind },
      "secret_kind_mismatch",
    );
  }

  await deleteSecret(database, command.secretId);
  return { status: "deleted" };
}

export async function deleteMcpOAuthFlowClientSecret(
  database: D1Database,
  command: DeleteMcpOAuthFlowClientSecretCommand,
): Promise<McpOAuthSecretDeleteOutcome> {
  if (!isTruthy(command.secretId)) {
    return { status: "skipped" };
  }

  if (command.flow.appId !== command.appId) {
    throw new Error("MCP OAuth flow client secret delete denied: flow_app_mismatch.");
  }

  const expectedKind = toMcpOAuthFlowClientSecretKind(command);
  const actualKind = await readSecretKind(database, command.secretId);

  if (actualKind === null) {
    return denyOAuthSecretDelete(
      { purpose: command.purpose, resourceId: command.flow.id, secretKind: command.secretKind },
      "secret_not_found",
    );
  }

  if (actualKind !== expectedKind) {
    return denyOAuthSecretDelete(
      { purpose: command.purpose, resourceId: command.flow.id, secretKind: command.secretKind },
      "secret_kind_mismatch",
    );
  }

  await deleteSecret(database, command.secretId);
  return { status: "deleted" };
}

export async function cleanupStoredMcpOAuthServerClientSecret(input: {
  command: DeleteMcpOAuthServerClientSecretCommand;
  database: D1Database;
}): Promise<boolean> {
  try {
    const outcome = await deleteMcpOAuthServerClientSecret(input.database, input.command);

    if (outcome.status !== "denied") {
      return true;
    }

    logError("mcp-oauth.server-client-secret-cleanup.denied", {
      ...actorLogContext(input.command.actor),
      purpose: outcome.purpose,
      appId: input.command.appId,
      reason: outcome.reason,
      secretId: input.command.secretId,
      secretKind: outcome.secretKind,
      serverId: input.command.server.id,
    });
  } catch (error) {
    logError("mcp-oauth.server-client-secret-cleanup.failed", {
      ...createErrorLogContext(error),
      ...actorLogContext(input.command.actor),
      purpose: input.command.purpose,
      appId: input.command.appId,
      secretId: input.command.secretId,
      secretKind: input.command.secretKind,
      serverId: input.command.server.id,
    });
  }

  return false;
}

export async function cleanupStoredMcpOAuthFlowClientSecret(input: {
  command: DeleteMcpOAuthFlowClientSecretCommand;
  database: D1Database;
}): Promise<boolean> {
  try {
    const outcome = await deleteMcpOAuthFlowClientSecret(input.database, input.command);

    if (outcome.status !== "denied") {
      return true;
    }

    logError("mcp-oauth.flow-client-secret-cleanup.denied", {
      ...actorLogContext(input.command.actor),
      flowId: input.command.flow.id,
      purpose: outcome.purpose,
      appId: input.command.appId,
      reason: outcome.reason,
      secretId: input.command.secretId,
      secretKind: outcome.secretKind,
      serverId: input.command.flow.serverId,
    });
  } catch (error) {
    logError("mcp-oauth.flow-client-secret-cleanup.failed", {
      ...createErrorLogContext(error),
      ...actorLogContext(input.command.actor),
      flowId: input.command.flow.id,
      purpose: input.command.purpose,
      appId: input.command.appId,
      secretId: input.command.secretId,
      secretKind: input.command.secretKind,
      serverId: input.command.flow.serverId,
    });
  }

  return false;
}

export async function readMcpOAuthServerClientSecret(
  bindings: McpOAuthSecretBindings,
  command: ReadMcpOAuthServerClientSecretCommand,
): Promise<McpOAuthSecretReadOutcome> {
  const serverDenial = hasServerOAuthAccess(command);

  if (serverDenial !== null) {
    return denyOAuthSecretRead(command, serverDenial);
  }

  if (!isTruthy(command.server.byoClientSecretSecretId)) {
    return denyOAuthSecretRead(command, "server_client_secret_missing");
  }

  const secret = await readSecretWithExpectedKind(bindings, {
    expectedKind: toMcpOAuthServerClientSecretKind(command),
    secretId: command.server.byoClientSecretSecretId,
  });

  if (secret.status === "denied") {
    return denyOAuthSecretRead(command, secret.reason);
  }

  return secret;
}

export async function readMcpOAuthFlowClientSecret(
  bindings: McpOAuthSecretBindings,
  command: ReadMcpOAuthFlowClientSecretCommand,
): Promise<McpOAuthSecretReadOutcome> {
  const serverDenial = hasServerOAuthAccess(command);

  if (serverDenial !== null) {
    return denyOAuthSecretRead(command, serverDenial);
  }

  if (command.flow.appId !== command.appId) {
    return denyOAuthSecretRead(command, "flow_app_mismatch");
  }

  if (command.flow.serverId !== command.server.id) {
    return denyOAuthSecretRead(command, "flow_server_mismatch");
  }

  if (command.flow.initiatorUserId !== command.actor.accountId) {
    return denyOAuthSecretRead(command, "flow_initiator_mismatch");
  }

  if (command.flow.status !== "pending") {
    return denyOAuthSecretRead(command, "flow_status_mismatch");
  }

  if (!isTruthy(command.flow.oauthClientSecretSecretId)) {
    return denyOAuthSecretRead(command, "flow_client_secret_missing");
  }

  const secret = await readSecretWithExpectedKind(bindings, {
    expectedKind: toMcpOAuthFlowClientSecretKind(command),
    secretId: command.flow.oauthClientSecretSecretId,
  });

  if (secret.status === "denied") {
    return denyOAuthSecretRead(command, secret.reason);
  }

  return secret;
}
