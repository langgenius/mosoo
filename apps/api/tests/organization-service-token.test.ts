import { describe, expect, test } from "bun:test";

import {
  createOrganizationServiceToken,
  listOrganizationServiceTokens,
  revokeOrganizationServiceToken,
} from "../src/modules/auth/application/organization-service-token.service";
import { authenticatePublicApiCaller } from "../src/modules/auth/application/public-api-caller.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};
const TOKEN_1_ID = "01J00000000000000000000061";
const TOKEN_2_ID = "01J00000000000000000000062";
const AGENT_2_ID = "01J0000000000000000000000G";
const AGENT_3_ID = "01J0000000000000000000000H";

function createOrganizationServiceTokenDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE organization (
      id text PRIMARY KEY NOT NULL,
      join_policy text NOT NULL
    );

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      disabled_by_account_id text,
      created_at integer NOT NULL,
      joined_at integer NOT NULL,
      PRIMARY KEY (organization_id, account_id)
    );

    CREATE TABLE organization_service_token (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      created_by_account_id text NOT NULL,
      label text NOT NULL,
      token_hash text NOT NULL,
      allow_attribution integer NOT NULL,
      last_used_at integer,
      revoked_at integer,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE organization_service_token_agent (
      token_id text NOT NULL,
      agent_id text NOT NULL,
      organization_id text NOT NULL,
      created_at integer NOT NULL,
      PRIMARY KEY (token_id, agent_id)
    );

    CREATE TABLE agent (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      status text NOT NULL
    );

    INSERT INTO organization (
      id,
      join_policy
    )
    VALUES ('01J00000000000000000000006', 'invite_only');

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at,
      disabled_by_account_id,
      created_at,
      joined_at
    )
    VALUES ('01J00000000000000000000006', '01J00000000000000000000001', 'owner', NULL, NULL, 1, 1);

    INSERT INTO organization_service_token (
      id,
      organization_id,
      created_by_account_id,
      label,
      token_hash,
      allow_attribution,
      last_used_at,
      revoked_at,
      created_at,
      updated_at
    )
    VALUES
      ('${TOKEN_1_ID}', '01J00000000000000000000006', '01J00000000000000000000001', 'Deploy key', 'hash-1', 0, NULL, NULL, 1, 1),
      ('${TOKEN_2_ID}', '01J00000000000000000000006', '01J00000000000000000000001', 'Ops key', 'hash-2', 1, 10, NULL, 2, 2);

    INSERT INTO organization_service_token_agent (
      token_id,
      agent_id,
      organization_id,
      created_at
    )
    VALUES
      ('${TOKEN_1_ID}', '${AGENT_2_ID}', '01J00000000000000000000006', 1),
      ('${TOKEN_1_ID}', '01J00000000000000000000009', '01J00000000000000000000006', 2),
      ('${TOKEN_2_ID}', '${AGENT_3_ID}', '01J00000000000000000000006', 3);

    INSERT INTO agent (
      id,
      organization_id,
      status
    )
    VALUES
      ('01J00000000000000000000009', '01J00000000000000000000006', 'published'),
      ('${AGENT_2_ID}', '01J00000000000000000000006', 'published'),
      ('${AGENT_3_ID}', '01J00000000000000000000006', 'published'),
      ('draft-agent', '01J00000000000000000000006', 'draft'),
      ('external-agent', 'org-2', 'published');
  `);

  return database;
}

describe("organization service tokens", () => {
  test("creates tokens with allowed agents", async () => {
    const database = createOrganizationServiceTokenDatabase();

    const response = await createOrganizationServiceToken(database, VIEWER, {
      allowAttribution: true,
      allowedAgentIds: [AGENT_2_ID, "01J00000000000000000000009"],
      label: "Runtime key",
      organizationId: "01J00000000000000000000006",
    });

    expect(response.value).toStartWith("grt_svc_");
    expect(response.token).toMatchObject({
      allowAttribution: true,
      allowedAgentIds: [AGENT_2_ID, "01J00000000000000000000009"],
      createdByAccountId: "01J00000000000000000000001",
      label: "Runtime key",
      organizationId: "01J00000000000000000000006",
      revokedAt: null,
    });

    const allowedAgents = await database
      .prepare(
        `
          SELECT agent_id
          FROM organization_service_token_agent
          WHERE token_id = ?
          ORDER BY agent_id
        `,
      )
      .bind(response.token.id)
      .all<{ agent_id: string }>();

    expect(allowedAgents.results?.map((row) => row.agent_id)).toEqual([
      "01J00000000000000000000009",
      AGENT_2_ID,
    ]);
  });

  test("lists tokens and allowed agents", async () => {
    const database = createOrganizationServiceTokenDatabase();

    const response = await listOrganizationServiceTokens(
      database,
      VIEWER,
      "01J00000000000000000000006",
    );

    expect(response.tokens).toEqual([
      {
        allowAttribution: true,
        allowedAgentIds: [AGENT_3_ID],
        createdAt: "1970-01-01T00:00:00.002Z",
        createdByAccountId: "01J00000000000000000000001",
        id: TOKEN_2_ID,
        label: "Ops key",
        lastUsedAt: "1970-01-01T00:00:00.010Z",
        organizationId: "01J00000000000000000000006",
        revokedAt: null,
      },
      {
        allowAttribution: false,
        allowedAgentIds: ["01J00000000000000000000009", AGENT_2_ID],
        createdAt: "1970-01-01T00:00:00.001Z",
        createdByAccountId: "01J00000000000000000000001",
        id: TOKEN_1_ID,
        label: "Deploy key",
        lastUsedAt: null,
        organizationId: "01J00000000000000000000006",
        revokedAt: null,
      },
    ]);
  });

  test("lists empty token sets", async () => {
    const database = createOrganizationServiceTokenDatabase();
    database.execute(`
      DELETE FROM organization_service_token_agent;
      DELETE FROM organization_service_token;
    `);

    const response = await listOrganizationServiceTokens(
      database,
      VIEWER,
      "01J00000000000000000000006",
    );

    expect(response.tokens).toEqual([]);
  });

  test("revokes a token", async () => {
    const database = createOrganizationServiceTokenDatabase();

    await revokeOrganizationServiceToken(database, VIEWER, TOKEN_1_ID);

    const token = await database
      .prepare("SELECT revoked_at FROM organization_service_token WHERE id = ?")
      .bind(TOKEN_1_ID)
      .first<{ revoked_at: number | null }>();

    expect(token?.revoked_at).toBeNumber();
  });

  test("rejects unsupported bearer token prefixes", async () => {
    const database = createOrganizationServiceTokenDatabase();

    const caller = await authenticatePublicApiCaller(database, "unsupported-token");

    expect(caller).toBeNull();
  });
});
