import { describe, expect, test } from "bun:test";

import type { AccountId, OrganizationId } from "@mosoo/id";

import { exportAuditEventsCsv } from "../src/modules/audit/application/audit-export.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const ORGANIZATION_ID = "01J00000000000000000000006" as OrganizationId;
const OWNER_ACCOUNT_ID = "01J00000000000000000000001" as AccountId;
const MEMBER_ACCOUNT_ID = "01J00000000000000000000002" as AccountId;

const VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: OWNER_ACCOUNT_ID,
  imageUrl: null,
  name: "Owner",
};

const MEMBER_VIEWER: AuthenticatedViewer = {
  email: "member@example.com",
  emailVerified: true,
  id: MEMBER_ACCOUNT_ID,
  imageUrl: null,
  name: "Member",
};

function createAuditExportDatabase(): SqliteD1Database {
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

    CREATE TABLE audit_event (
      action text NOT NULL,
      after_json text,
      actor_display text NOT NULL,
      actor_id text,
      actor_type text NOT NULL,
      before_json text,
      correlation_id text,
      id text PRIMARY KEY NOT NULL,
      ip_address text,
      metadata_json text,
      organization_id text NOT NULL,
      outcome text NOT NULL,
      resource_display text,
      resource_id text,
      resource_type text NOT NULL,
      session_id text,
      timestamp integer NOT NULL,
      user_agent text
    );

    INSERT INTO organization (id, join_policy)
    VALUES ('${ORGANIZATION_ID}', 'auto');

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at,
      disabled_by_account_id,
      created_at,
      joined_at
    )
    VALUES
      ('${ORGANIZATION_ID}', '${OWNER_ACCOUNT_ID}', 'owner', NULL, NULL, 1, 1),
      ('${ORGANIZATION_ID}', '${MEMBER_ACCOUNT_ID}', 'member', NULL, NULL, 1, 1);

    INSERT INTO audit_event (
      action,
      after_json,
      actor_display,
      actor_id,
      actor_type,
      before_json,
      correlation_id,
      id,
      ip_address,
      metadata_json,
      organization_id,
      outcome,
      resource_display,
      resource_id,
      resource_type,
      session_id,
      timestamp,
      user_agent
    )
    VALUES (
      'agent.update',
      NULL,
      'Owner',
      'account-1',
      'user',
      NULL,
      NULL,
      'event-1',
      '203.0.113.10',
      '{}',
      '${ORGANIZATION_ID}',
      'success',
      'Support agent',
      '01J00000000000000000000009',
      'agent',
      NULL,
      1000,
      'test-agent'
    );
  `);

  return database;
}

describe("audit export", () => {
  test("exports permitted audit events", async () => {
    const database = createAuditExportDatabase();

    const { csv } = await exportAuditEventsCsv(database, VIEWER, {
      organizationId: ORGANIZATION_ID,
    });

    expect(csv).toContain('"event-1"');
    expect(csv).toContain('"agent.update"');
  });

  test("audits denied export attempts without leaking sensitive fields", async () => {
    const database = createAuditExportDatabase();

    await expect(
      exportAuditEventsCsv(database, MEMBER_VIEWER, {
        organizationId: ORGANIZATION_ID,
        q: "Support agent",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });

    const row = await database
      .prepare(
        `SELECT action, actor_id, metadata_json, outcome, resource_type
           FROM audit_event
          WHERE action = 'audit_log.export'
          ORDER BY timestamp DESC
          LIMIT 1`,
      )
      .first<{
        action: string;
        actor_id: string | null;
        metadata_json: string;
        outcome: string;
        resource_type: string;
      }>();

    expect(row).toMatchObject({
      action: "audit_log.export",
      actor_id: MEMBER_ACCOUNT_ID,
      outcome: "denied",
      resource_type: "audit_log",
    });
    const metadata = JSON.parse(row?.metadata_json ?? "{}") as Record<string, unknown>;
    expect(metadata).toMatchObject({
      actorEmail: "member@example.com",
      errorCode: "FORBIDDEN",
      q: "Support agent",
      reason: "You do not have permission to perform this action.",
    });
    expect(metadata).not.toHaveProperty("before");
    expect(metadata).not.toHaveProperty("after");
  });
});
