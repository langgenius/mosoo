import { accountsTable, agentChannelBindingsTable, agentsTable } from "@mosoo/db";
import type { AgentChannelBindingProvider } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { AccountId, ChannelBindingId, OrganizationId } from "@mosoo/id";
import { and, eq } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import type { AuthenticatedViewer } from "../../auth/application/viewer-auth.service";
import { readAgentChannelBindingCredentialSecret } from "./channel-credential-secret-resolution";
import { parseChannelDisplayMetadata } from "./channel-display-metadata";
import type { AgentChannelBindingContext } from "./channel-session.types";

function toOwnerViewer(row: {
  email: string;
  emailVerified: boolean | number;
  id: string;
  imageUrl: string | null;
  name: string;
}): AuthenticatedViewer {
  return {
    email: row.email,
    emailVerified: row.emailVerified === true || row.emailVerified === 1,
    id: parsePlatformId<AccountId>(row.id, "owner account ID"),
    imageUrl: row.imageUrl,
    name: row.name,
  };
}

export async function resolveAgentChannelBindingContextById(
  bindings: ApiBindings,
  input: {
    bindingId: ChannelBindingId;
    provider: AgentChannelBindingProvider;
  },
): Promise<AgentChannelBindingContext | null> {
  const row =
    (await getAppDatabase(bindings.DB)
      .select({
        agentId: agentChannelBindingsTable.agentId,
        agentStatus: agentsTable.status,
        bindingId: agentChannelBindingsTable.id,
        displayMetadataJson: agentChannelBindingsTable.displayMetadataJson,
        encryptedCredsSecretId: agentChannelBindingsTable.encryptedCredsSecretId,
        externalBotId: agentChannelBindingsTable.externalBotId,
        externalTenantId: agentChannelBindingsTable.externalTenantId,
        organizationId: agentsTable.organizationId,
        ownerEmail: accountsTable.email,
        ownerEmailVerified: accountsTable.emailVerified,
        ownerId: accountsTable.id,
        ownerImageUrl: accountsTable.image,
        ownerName: accountsTable.name,
        provider: agentChannelBindingsTable.provider,
      })
      .from(agentChannelBindingsTable)
      .innerJoin(agentsTable, eq(agentsTable.id, agentChannelBindingsTable.agentId))
      .innerJoin(accountsTable, eq(accountsTable.id, agentsTable.ownerId))
      .where(
        and(
          eq(agentChannelBindingsTable.id, input.bindingId),
          eq(agentChannelBindingsTable.provider, input.provider),
          eq(agentChannelBindingsTable.status, "active"),
        ),
      )
      .limit(1)
      .get()) ?? null;

  if (!row) {
    return null;
  }

  return {
    agentId: row.agentId,
    agentStatus: row.agentStatus,
    bindingId: row.bindingId,
    credentialsJson: await readAgentChannelBindingCredentialSecret(bindings, {
      bindingId: row.bindingId,
      expectedOwner: {
        agentId: row.agentId,
        organizationId: parsePlatformId<OrganizationId>(row.organizationId, "organization ID"),
      },
      provider: row.provider,
      purpose: "channel_context",
      secretId: row.encryptedCredsSecretId,
    }),
    displayMetadata: parseChannelDisplayMetadata(row.displayMetadataJson),
    externalBotId: row.externalBotId,
    externalTenantId: row.externalTenantId,
    owner: toOwnerViewer({
      email: row.ownerEmail,
      emailVerified: row.ownerEmailVerified,
      id: row.ownerId,
      imageUrl: row.ownerImageUrl,
      name: row.ownerName,
    }),
    provider: row.provider,
  };
}
