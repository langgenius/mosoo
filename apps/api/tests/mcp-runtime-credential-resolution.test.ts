import { describe, expect, test } from "bun:test";

import type { AccountId, AgentId, CredentialId, McpServerId } from "@mosoo/id";

import { resolveCredentialsForMcpBindings } from "../src/modules/mcp/application/mcp-credential.repository";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_ID = "01J00000000000000000000001" as AccountId;
const AGENT_ID = "01J00000000000000000000002" as AgentId;
const OTHER_AGENT_ID = "01J00000000000000000000003" as AgentId;
const SERVER_ID = "01J00000000000000000000004" as McpServerId;
const OTHER_SERVER_ID = "01J00000000000000000000005" as McpServerId;
const MATCHING_CREDENTIAL_ID = "01J00000000000000000000006" as CredentialId;
const WRONG_AGENT_CREDENTIAL_ID = "01J00000000000000000000007" as CredentialId;
const WRONG_SERVER_CREDENTIAL_ID = "01J00000000000000000000008" as CredentialId;
const USER_CREDENTIAL_ID = "01J00000000000000000000009" as CredentialId;

function createCredentialResolutionDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE mcp_credential (
      account_id text,
      agent_id text,
      auth_type text NOT NULL,
      created_at integer NOT NULL,
      expires_at integer,
      id text PRIMARY KEY NOT NULL,
      last_refreshed_at integer,
      oauth_client_id text,
      oauth_client_secret_secret_id text,
      refresh_secret_id text,
      scope text NOT NULL,
      scope_values_json text,
      secret_id text NOT NULL,
      server_id text NOT NULL,
      status text NOT NULL,
      subject_label text,
      updated_at integer NOT NULL
    );
  `);

  return database;
}

async function insertCredential(
  database: SqliteD1Database,
  input: {
    accountId?: AccountId | null;
    agentId?: AgentId | null;
    credentialId: CredentialId;
    scope: "agent" | "organization_shared" | "user";
    serverId: McpServerId;
  },
): Promise<void> {
  await database
    .prepare(
      `
        INSERT INTO mcp_credential (
          account_id,
          agent_id,
          auth_type,
          created_at,
          expires_at,
          id,
          last_refreshed_at,
          oauth_client_id,
          oauth_client_secret_secret_id,
          refresh_secret_id,
          scope,
          scope_values_json,
          secret_id,
          server_id,
          status,
          subject_label,
          updated_at
        )
        VALUES (?, ?, 'bearer', 1, NULL, ?, NULL, NULL, NULL, NULL, ?, '[]', ?, ?, 'active', NULL, 1)
      `,
    )
    .bind(
      input.accountId ?? null,
      input.agentId ?? null,
      input.credentialId,
      input.scope,
      `${input.credentialId}:secret`,
      input.serverId,
    )
    .run();
}

describe("MCP runtime credential resolution", () => {
  test("matches explicit agent credential ids back to binding owner and server", async () => {
    const database = createCredentialResolutionDatabase();

    await insertCredential(database, {
      agentId: AGENT_ID,
      credentialId: MATCHING_CREDENTIAL_ID,
      scope: "agent",
      serverId: SERVER_ID,
    });
    await insertCredential(database, {
      agentId: OTHER_AGENT_ID,
      credentialId: WRONG_AGENT_CREDENTIAL_ID,
      scope: "agent",
      serverId: SERVER_ID,
    });
    await insertCredential(database, {
      agentId: AGENT_ID,
      credentialId: WRONG_SERVER_CREDENTIAL_ID,
      scope: "agent",
      serverId: OTHER_SERVER_ID,
    });
    await insertCredential(database, {
      accountId: OWNER_ID,
      credentialId: USER_CREDENTIAL_ID,
      scope: "user",
      serverId: SERVER_ID,
    });

    const credentials = await resolveCredentialsForMcpBindings(
      database,
      [
        {
          agentCredentialId: MATCHING_CREDENTIAL_ID,
          agentId: AGENT_ID,
          credentialMode: "agent_bound",
          credentialScope: "user",
          serverId: SERVER_ID,
        },
        {
          agentCredentialId: WRONG_AGENT_CREDENTIAL_ID,
          agentId: AGENT_ID,
          credentialMode: "agent_bound",
          credentialScope: "user",
          serverId: SERVER_ID,
        },
        {
          agentCredentialId: WRONG_SERVER_CREDENTIAL_ID,
          agentId: AGENT_ID,
          credentialMode: "agent_bound",
          credentialScope: "user",
          serverId: SERVER_ID,
        },
        {
          agentCredentialId: USER_CREDENTIAL_ID,
          agentId: AGENT_ID,
          credentialMode: "agent_bound",
          credentialScope: "user",
          serverId: SERVER_ID,
        },
      ],
      OWNER_ID,
    );

    expect(credentials.map((credential) => credential?.id ?? null)).toEqual([
      MATCHING_CREDENTIAL_ID,
      null,
      null,
      null,
    ]);
  });
});
