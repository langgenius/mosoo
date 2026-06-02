import { describe, expect, test } from "bun:test";

import type { GraphQLContext } from "../src/adapters/graphql/graphql-context";
import { composeGraphQLModules } from "../src/adapters/graphql/graphql-module";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { appendDeniedControlOperationAuditEvent } from "../src/modules/control-operations/application/control-operation-outcome-audit.service";
import { getSessionCallerAccess } from "../src/modules/sessions/domain/session-access.policy";
import { forbiddenError, notFoundError } from "../src/platform/errors";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const SESSION_ID = "01J00000000000000000000001";
const VIEWER_ID = "01J00000000000000000000002";
const CREATOR_ACCOUNT_ID = "01J00000000000000000000003";

const VIEWER: AuthenticatedViewer = {
  auditContext: {
    ipAddress: "203.0.113.10",
    userAgent: "test-agent",
  },
  email: "viewer@example.com",
  emailVerified: true,
  id: VIEWER_ID,
  imageUrl: null,
  name: "Denied Viewer",
};

function createSessionAuditDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      archived_at integer,
      agent_id text NOT NULL,
      attributed_user_id text,
      creator_account_id text NOT NULL,
      deployment_version_id text,
      deployment_version_number integer,
      metadata_json text DEFAULT '{}' NOT NULL,
      model text NOT NULL,
      organization_id text NOT NULL,
      provider text NOT NULL,
      runtime_id text NOT NULL,
      status text NOT NULL,
      title text
    );

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      PRIMARY KEY (organization_id, account_id)
    );

    CREATE TABLE agent (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      name text NOT NULL
    );

    CREATE TABLE audit_event (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      timestamp integer NOT NULL,
      actor_type text NOT NULL,
      actor_id text,
      actor_display text NOT NULL,
      action text NOT NULL,
      resource_type text NOT NULL,
      resource_id text,
      resource_display text,
      outcome text NOT NULL,
      ip_address text,
      user_agent text,
      session_id text,
      correlation_id text,
      before_json text,
      after_json text,
      metadata_json text
    );

    INSERT INTO session (
      id,
      agent_id,
      creator_account_id,
      metadata_json,
      model,
      organization_id,
      provider,
      runtime_id,
      status,
      title
    ) VALUES (
      '${SESSION_ID}',
      '01J00000000000000000000009',
      '${CREATOR_ACCOUNT_ID}',
      '{}',
      'gpt-5.1',
      '01J00000000000000000000006',
      'openai',
      'openai-runtime',
      'IDLE',
      'Customer triage'
    );

    INSERT INTO agent (
      id,
      organization_id,
      name
    ) VALUES (
      '01J00000000000000000000009',
      '01J00000000000000000000006',
      'Support Agent'
    );
  `);

  return database;
}

function createGraphQLContext(database: D1Database): GraphQLContext {
  return {
    bindings: {
      DB: database,
    },
    executionContext: null,
    request: new Request("https://api.test/graphql"),
    serverContext: {},
    viewer: VIEWER,
  } as GraphQLContext;
}

async function countAuditEvents(database: D1Database): Promise<number> {
  const row = await database.prepare("SELECT COUNT(*) AS count FROM audit_event").first<{
    count: number;
  }>();

  return row?.count ?? 0;
}

describe("control operation outcome audit", () => {
  test("records denied read-side session queries without logging successful reads", async () => {
    const deniedDatabase = createSessionAuditDatabase();
    const deniedResolver = composeGraphQLModules([
      {
        authenticatedQueryResolvers: {
          listSessionResources: async () => {
            throw forbiddenError("You do not have permission to view this session.");
          },
        },
        queryFields: ["listSessionResources(sessionId: ID!): [String!]!"],
      },
    ]).queryResolvers["listSessionResources"];

    await expect(
      deniedResolver(null, { sessionId: SESSION_ID }, createGraphQLContext(deniedDatabase)),
    ).rejects.toMatchObject({
      extensions: {
        code: "FORBIDDEN",
      },
    });

    const deniedRow = await deniedDatabase
      .prepare(
        `
          SELECT
            action,
            metadata_json,
            organization_id,
            outcome,
            resource_display,
            resource_id,
            resource_type,
            session_id
          FROM audit_event
        `,
      )
      .first<{
        action: string;
        metadata_json: string | null;
        organization_id: string;
        outcome: string;
        resource_display: string | null;
        resource_id: string | null;
        resource_type: string;
        session_id: string | null;
      }>();

    expect(deniedRow).toMatchObject({
      action: "session.update",
      organization_id: "01J00000000000000000000006",
      outcome: "denied",
      resource_display: "Customer triage",
      resource_id: SESSION_ID,
      resource_type: "session",
      session_id: SESSION_ID,
    });
    expect(JSON.parse(deniedRow?.metadata_json ?? "{}")).toMatchObject({
      operationName: "listSessionResources",
      reason: "You do not have permission to view this session.",
    });

    const successfulDatabase = createSessionAuditDatabase();
    const successfulResolver = composeGraphQLModules([
      {
        authenticatedQueryResolvers: {
          listSessionResources: async () => [],
        },
        queryFields: ["listSessionResources(sessionId: ID!): [String!]!"],
      },
    ]).queryResolvers["listSessionResources"];

    await expect(
      successfulResolver(null, { sessionId: SESSION_ID }, createGraphQLContext(successfulDatabase)),
    ).resolves.toEqual([]);
    expect(await countAuditEvents(successfulDatabase)).toBe(0);
  });

  test("records typed denied credential mutation not-found metadata without secret-bearing args", async () => {
    const database = createSessionAuditDatabase();
    const secretValue = "sk-test_1234567890abcdef1234567890abcdef";
    const deniedResolver = composeGraphQLModules([
      {
        authenticatedMutationResolvers: {
          updateVendorCredential: async () => {
            throw notFoundError("Credential not found.");
          },
        },
        mutationFields: ["updateVendorCredential(input: UpdateVendorCredentialInput!): String"],
      },
    ]).mutationResolvers["updateVendorCredential"];

    await expect(
      deniedResolver(
        null,
        {
          input: {
            apiKey: secretValue,
            credentialId: "01J00000000000000000000010",
            name: "Shared OpenAI",
            organizationId: "01J00000000000000000000006",
          },
        },
        createGraphQLContext(database),
      ),
    ).rejects.toMatchObject({
      extensions: {
        code: "NOT_FOUND",
        http: {
          status: 404,
        },
      },
      message: "Credential not found.",
    });

    const row = await database
      .prepare(
        `
          SELECT
            after_json,
            before_json,
            metadata_json,
            organization_id,
            outcome,
            resource_display,
            resource_id,
            resource_type
          FROM audit_event
        `,
      )
      .first<{
        after_json: string | null;
        before_json: string | null;
        metadata_json: string;
        organization_id: string;
        outcome: string;
        resource_display: string | null;
        resource_id: string | null;
        resource_type: string;
      }>();

    expect(row).toMatchObject({
      after_json: null,
      before_json: null,
      organization_id: "01J00000000000000000000006",
      outcome: "denied",
      resource_display: "Shared OpenAI",
      resource_id: "01J00000000000000000000010",
      resource_type: "credential",
    });

    const metadata = JSON.parse(row?.metadata_json ?? "{}") as Record<string, unknown>;
    expect(metadata).toMatchObject({
      errorCode: "NOT_FOUND",
      operationName: "updateVendorCredential",
      reason: "Credential not found.",
      status: 404,
    });
    expect(JSON.stringify(metadata)).not.toContain(secretValue);
    expect(JSON.stringify(metadata)).not.toContain("apiKey");
  });

  test("records denied session working-state attempts against the session organization", async () => {
    const database = createSessionAuditDatabase();

    await appendDeniedControlOperationAuditEvent(database, {
      args: {
        events: [{ text: "hello", type: "user_message" }],
        sessionId: SESSION_ID,
      },
      error: forbiddenError(),
      operationName: "sendAgentSessionEvents",
      viewer: VIEWER,
    });

    const row = await database
      .prepare(
        `
          SELECT
            action,
            actor_id,
            actor_type,
            ip_address,
            metadata_json,
            organization_id,
            outcome,
            resource_display,
            resource_id,
            resource_type,
            session_id,
            user_agent
          FROM audit_event
        `,
      )
      .first<{
        action: string;
        actor_id: string | null;
        actor_type: string;
        ip_address: string | null;
        metadata_json: string | null;
        organization_id: string;
        outcome: string;
        resource_display: string | null;
        resource_id: string | null;
        resource_type: string;
        session_id: string | null;
        user_agent: string | null;
      }>();

    expect(row).toMatchObject({
      action: "session.update",
      actor_id: VIEWER_ID,
      actor_type: "user",
      ip_address: "203.0.113.10",
      organization_id: "01J00000000000000000000006",
      outcome: "denied",
      resource_display: "Customer triage",
      resource_id: SESSION_ID,
      resource_type: "session",
      session_id: SESSION_ID,
      user_agent: "test-agent",
    });
    expect(JSON.parse(row?.metadata_json ?? "{}")).toMatchObject({
      operationName: "sendAgentSessionEvents",
      reason: "You do not have permission to perform this action.",
    });
  });

  test("uses the persisted session as the source of truth for denied session attribution", async () => {
    const database = createSessionAuditDatabase();

    await appendDeniedControlOperationAuditEvent(database, {
      args: {
        events: [{ text: "hello", type: "user_message" }],
        organizationId: "spoofed-org",
        sessionId: SESSION_ID,
        title: "Spoofed title",
      },
      error: forbiddenError(),
      operationName: "sendAgentSessionEvents",
      viewer: VIEWER,
    });

    const row = await database
      .prepare(
        `
          SELECT
            organization_id,
            resource_display,
            resource_id,
            session_id
          FROM audit_event
        `,
      )
      .first<{
        organization_id: string;
        resource_display: string | null;
        resource_id: string | null;
        session_id: string | null;
      }>();

    expect(row).toMatchObject({
      organization_id: "01J00000000000000000000006",
      resource_display: "Customer triage",
      resource_id: SESSION_ID,
      session_id: SESSION_ID,
    });
  });

  test("does not write denied session audit rows against caller-supplied organizations", async () => {
    const database = createSessionAuditDatabase();

    await appendDeniedControlOperationAuditEvent(database, {
      args: {
        events: [{ text: "hello", type: "user_message" }],
        organizationId: "spoofed-org",
        sessionId: "missing-session",
        title: "Spoofed title",
      },
      error: forbiddenError(),
      operationName: "sendAgentSessionEvents",
      viewer: VIEWER,
    });

    const row = await database.prepare("SELECT COUNT(*) AS count FROM audit_event").first<{
      count: number;
    }>();

    expect(row?.count).toBe(0);
  });

  test("records denied create-session attempts against the Agent organization", async () => {
    const database = createSessionAuditDatabase();

    await appendDeniedControlOperationAuditEvent(database, {
      args: {
        agentId: "01J00000000000000000000009",
        organizationId: "spoofed-org",
        title: "Spoofed title",
      },
      error: forbiddenError(),
      operationName: "createAgentSession",
      viewer: VIEWER,
    });

    const row = await database
      .prepare(
        `
          SELECT
            action,
            organization_id,
            resource_display,
            resource_id,
            resource_type
          FROM audit_event
        `,
      )
      .first<{
        action: string;
        organization_id: string;
        resource_display: string | null;
        resource_id: string | null;
        resource_type: string;
      }>();

    expect(row).toMatchObject({
      action: "session.create",
      organization_id: "01J00000000000000000000006",
      resource_display: "Support Agent",
      resource_id: "01J00000000000000000000009",
      resource_type: "session",
    });
  });

  test("does not write denied create-session audit rows for missing Agents", async () => {
    const database = createSessionAuditDatabase();

    await appendDeniedControlOperationAuditEvent(database, {
      args: {
        agentId: "missing-agent",
        organizationId: "spoofed-org",
        title: "Spoofed title",
      },
      error: forbiddenError(),
      operationName: "createAgentSession",
      viewer: VIEWER,
    });

    const row = await database.prepare("SELECT COUNT(*) AS count FROM audit_event").first<{
      count: number;
    }>();

    expect(row?.count).toBe(0);
  });

  test("classifies non-creator session operation access as forbidden", async () => {
    await expect(
      getSessionCallerAccess(createSessionAuditDatabase(), VIEWER_ID, SESSION_ID),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });
});
