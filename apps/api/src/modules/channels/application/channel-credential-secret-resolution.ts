import { agentChannelBindingsTable, agentsTable, vaultSecretsTable } from "@mosoo/db";
import type { AgentChannelBindingProvider } from "@mosoo/db";
import type { AgentId, ChannelBindingId, OrganizationId, PlatformId } from "@mosoo/id";
import { parsePlatformId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import { createErrorLogContext, logError } from "../../../platform/cloudflare/logger";
import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { validationError } from "../../../platform/errors";
import { isTruthy } from "../../../shared/truthiness";
import {
  deleteSecret,
  readSecretOutcome,
  storeSecret,
} from "../../mcp/application/mcp-secret-store";

export type ChannelCredentialSecretReadPurpose =
  | "channel_callback"
  | "channel_context"
  | "channel_final_delivery";

export type ChannelCredentialSecretWritePurpose =
  | "channel_binding_create"
  | "channel_binding_update";

export type ChannelCredentialSecretDeletePurpose =
  | "channel_binding_create_rollback"
  | "channel_binding_delete"
  | "channel_binding_orphan_maintenance"
  | "channel_binding_replace_cleanup"
  | "channel_binding_write_rollback";

export type ChannelCredentialSecretDeleteOutcome =
  | {
      status: "deleted" | "skipped";
    }
  | {
      agentId: AgentId;
      organizationId: OrganizationId;
      provider: AgentChannelBindingProvider;
      purpose: ChannelCredentialSecretDeletePurpose;
      reason: "secret_kind_mismatch" | "secret_not_found";
      status: "denied";
    };

const AGENT_CHANNEL_BINDING_PROVIDERS = [
  "discord",
  "lark",
  "slack",
  "telegram",
  "wechat",
] as const satisfies readonly AgentChannelBindingProvider[];

export const CHANNEL_BINDING_CREDENTIAL_SECRET_KIND_PREFIX = "channel_binding:";

function assertChannelCredentialReadPurpose(purpose: ChannelCredentialSecretReadPurpose): void {
  switch (purpose) {
    case "channel_callback":
    case "channel_context":
    case "channel_final_delivery": {
      return;
    }
  }
}

function assertChannelCredentialWritePurpose(purpose: ChannelCredentialSecretWritePurpose): void {
  switch (purpose) {
    case "channel_binding_create":
    case "channel_binding_update": {
      return;
    }
  }
}

interface AgentChannelBindingCredentialSecretOwner {
  readonly agentId: AgentId;
  readonly organizationId: OrganizationId;
  readonly provider: AgentChannelBindingProvider;
}

function toAgentChannelBindingCredentialSecretKind(
  owner: AgentChannelBindingCredentialSecretOwner,
): string {
  return ["channel_binding", owner.organizationId, owner.agentId, owner.provider].join(":");
}

function isAgentChannelBindingProvider(value: string): value is AgentChannelBindingProvider {
  return AGENT_CHANNEL_BINDING_PROVIDERS.some((provider) => provider === value);
}

export function parseAgentChannelBindingCredentialSecretKind(
  kind: string,
): AgentChannelBindingCredentialSecretOwner | null {
  const [prefix, organizationId, agentId, provider, extra] = kind.split(":");

  if (
    prefix !== "channel_binding" ||
    organizationId === undefined ||
    agentId === undefined ||
    provider === undefined ||
    extra !== undefined ||
    !isAgentChannelBindingProvider(provider)
  ) {
    return null;
  }

  try {
    return {
      agentId: parsePlatformId<AgentId>(agentId, "agent ID"),
      organizationId: parsePlatformId<OrganizationId>(organizationId, "organization ID"),
      provider,
    };
  } catch {
    return null;
  }
}

async function readVaultSecretKind(
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

export async function storeAgentChannelBindingCredentialSecret(
  bindings: ApiBindings,
  input: AgentChannelBindingCredentialSecretOwner & {
    readonly credentialsJson: string;
    readonly purpose: ChannelCredentialSecretWritePurpose;
  },
): Promise<PlatformId> {
  assertChannelCredentialWritePurpose(input.purpose);

  return storeSecret(bindings.DB, bindings, {
    kind: toAgentChannelBindingCredentialSecretKind(input),
    value: input.credentialsJson,
  });
}

export async function readAgentChannelBindingCredentialSecret(
  bindings: ApiBindings,
  input: {
    bindingId: ChannelBindingId;
    expectedOwner: {
      readonly agentId: AgentId;
      readonly organizationId: OrganizationId;
    };
    provider: AgentChannelBindingProvider;
    purpose: ChannelCredentialSecretReadPurpose;
    secretId: PlatformId;
  },
): Promise<string> {
  assertChannelCredentialReadPurpose(input.purpose);

  const row =
    (await getAppDatabase(bindings.DB)
      .select({
        agentId: agentChannelBindingsTable.agentId,
        organizationId: agentsTable.organizationId,
        secretKind: vaultSecretsTable.kind,
      })
      .from(agentChannelBindingsTable)
      .innerJoin(agentsTable, eq(agentsTable.id, agentChannelBindingsTable.agentId))
      .innerJoin(
        vaultSecretsTable,
        eq(vaultSecretsTable.id, agentChannelBindingsTable.encryptedCredsSecretId),
      )
      .where(
        and(
          eq(agentChannelBindingsTable.id, input.bindingId),
          eq(agentChannelBindingsTable.provider, input.provider),
          eq(agentChannelBindingsTable.status, "active"),
          eq(agentChannelBindingsTable.encryptedCredsSecretId, input.secretId),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (
    !row ||
    row.agentId !== input.expectedOwner.agentId ||
    row.organizationId !== input.expectedOwner.organizationId ||
    row.secretKind !==
      toAgentChannelBindingCredentialSecretKind({
        agentId: row.agentId,
        organizationId: row.organizationId,
        provider: input.provider,
      })
  ) {
    throw validationError("Channel binding credential is unavailable.");
  }

  const secret = await readSecretOutcome(bindings.DB, bindings, input.secretId);

  if (secret.status === "missing") {
    throw validationError("Channel binding credential is unavailable.");
  }

  return secret.value;
}

function denyAgentChannelBindingCredentialSecretDelete(
  command: AgentChannelBindingCredentialSecretOwner & {
    purpose: ChannelCredentialSecretDeletePurpose;
  },
  reason: "secret_kind_mismatch" | "secret_not_found",
): ChannelCredentialSecretDeleteOutcome {
  return {
    agentId: command.agentId,
    organizationId: command.organizationId,
    provider: command.provider,
    purpose: command.purpose,
    reason,
    status: "denied",
  };
}

export async function deleteAgentChannelBindingCredentialSecret(
  database: D1Database,
  command: AgentChannelBindingCredentialSecretOwner & {
    purpose: ChannelCredentialSecretDeletePurpose;
    secretId: PlatformId | string | null | undefined;
  },
): Promise<ChannelCredentialSecretDeleteOutcome> {
  if (!isTruthy(command.secretId)) {
    return { status: "skipped" };
  }

  const expectedKind = toAgentChannelBindingCredentialSecretKind(command);
  const actualKind = await readVaultSecretKind(database, command.secretId);

  if (actualKind === null) {
    return denyAgentChannelBindingCredentialSecretDelete(command, "secret_not_found");
  }

  if (actualKind !== expectedKind) {
    return denyAgentChannelBindingCredentialSecretDelete(command, "secret_kind_mismatch");
  }

  await deleteSecret(database, command.secretId);
  return { status: "deleted" };
}

export async function cleanupStoredAgentChannelBindingCredentialSecret(input: {
  command: AgentChannelBindingCredentialSecretOwner & {
    purpose: ChannelCredentialSecretDeletePurpose;
    secretId: PlatformId | string | null | undefined;
  };
  database: D1Database;
}): Promise<boolean> {
  try {
    const outcome = await deleteAgentChannelBindingCredentialSecret(input.database, input.command);

    if (outcome.status !== "denied") {
      return true;
    }

    logError("agent-channel-binding.credential-secret-cleanup.denied", {
      agentId: outcome.agentId,
      organizationId: outcome.organizationId,
      provider: outcome.provider,
      purpose: outcome.purpose,
      reason: outcome.reason,
      secretId: input.command.secretId,
    });
  } catch (error) {
    logError("agent-channel-binding.credential-secret-cleanup.failed", {
      ...createErrorLogContext(error),
      agentId: input.command.agentId,
      organizationId: input.command.organizationId,
      provider: input.command.provider,
      purpose: input.command.purpose,
      secretId: input.command.secretId,
    });
  }

  return false;
}
