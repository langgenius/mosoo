import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { removeOrganizationMember } from "../src/modules/organizations/application/organization-member-removal.service";
import {
  listOrganizationMembers,
  setOrganizationMemberStatus,
  updateOrganizationMemberRole,
} from "../src/modules/organizations/application/organization-members.service";
import { grantOrganizationMembership } from "../src/modules/organizations/application/organization-membership.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const ADMIN_ID = "01J000000000000000000000K4";
const MEMBER_TWO_ID = "01J000000000000000000000K5";
const ORGANIZATION_ID = "01J00000000000000000000006";

const VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

function createOrganizationMembershipDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      email text NOT NULL,
      email_verified integer NOT NULL,
      image_url text,
      last_active_organization_id text,
      name text NOT NULL,
      system_agent_model text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

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

    CREATE TABLE session (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      creator_account_id text NOT NULL
    );

    CREATE TABLE agent (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL
    );

    CREATE TABLE environment (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL
    );

    CREATE TABLE skill (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL
    );

    CREATE TABLE space (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL
    );

    CREATE TABLE mcp_server (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      source text NOT NULL
    );

    CREATE TABLE resource_acl (
      resource_type text NOT NULL,
      resource_id text NOT NULL,
      target_kind text NOT NULL,
      target_id text NOT NULL,
      assigned_by_account_id text
    );

    CREATE TABLE vendor_credential (
      organization_id text NOT NULL,
      owner_account_id text
    );

    CREATE TABLE skill_preference (
      account_id text NOT NULL,
      skill_id text NOT NULL
    );

    CREATE TABLE mcp_oauth_flow (
      organization_id text NOT NULL,
      initiator_account_id text NOT NULL
    );

    CREATE TABLE mcp_credential (
      account_id text,
      server_id text NOT NULL
    );

    CREATE TABLE agent_mcp_binding (
      server_id text NOT NULL
    );

    INSERT INTO account (
      id,
      email,
      email_verified,
      image_url,
      last_active_organization_id,
      name,
      system_agent_model,
      created_at,
      updated_at
    )
    VALUES
      ('01J00000000000000000000001', 'owner@example.com', 1, NULL, '01J00000000000000000000006', 'Owner', NULL, 1, 1),
      ('01J00000000000000000000002', 'member@example.com', 1, NULL, '01J00000000000000000000006', 'Member One', NULL, 1, 1),
      ('${MEMBER_TWO_ID}', 'member2@example.com', 1, NULL, '${ORGANIZATION_ID}', 'Member Two', NULL, 1, 1);

    INSERT INTO organization (id, join_policy)
    VALUES ('01J00000000000000000000006', 'request');

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
      ('${ORGANIZATION_ID}', '01J00000000000000000000001', 'owner', NULL, NULL, 1, 1),
      ('${ORGANIZATION_ID}', '01J00000000000000000000002', 'member', 1000, '${ADMIN_ID}', 1, 2),
      ('${ORGANIZATION_ID}', '${MEMBER_TWO_ID}', 'member', NULL, NULL, 1, 3);
  `);

  return database;
}

describe("organization membership grants", () => {
  test("reactivates an existing disabled member", async () => {
    const database = createOrganizationMembershipDatabase();

    await grantOrganizationMembership(database, {
      accountId: "01J00000000000000000000002",
      organizationId: ORGANIZATION_ID,
      role: "member",
    });

    const member = await database
      .prepare(
        `
          SELECT disabled_at, disabled_by_account_id, role
          FROM organization_member
          WHERE organization_id = '${ORGANIZATION_ID}' AND account_id = '01J00000000000000000000002'
        `,
      )
      .first<{
        disabled_at: number | null;
        disabled_by_account_id: string | null;
        role: string;
      }>();

    expect(member).toEqual({
      disabled_at: null,
      disabled_by_account_id: null,
      role: "member",
    });
  });
});

describe("organization member mutations", () => {
  test("lists members for permitted viewers", async () => {
    const database = createOrganizationMembershipDatabase();

    const members = await listOrganizationMembers(database, VIEWER, ORGANIZATION_ID);

    expect(members).toHaveLength(3);
    expect(members.map((member) => member.accountId)).toEqual([
      "01J00000000000000000000001",
      "01J00000000000000000000002",
      MEMBER_TWO_ID,
    ]);
    expect(
      members.find((member) => member.accountId === "01J00000000000000000000002"),
    ).toMatchObject({
      disabledByAccountId: ADMIN_ID,
      status: "disabled",
    });
  });

  test("returns role updates", async () => {
    const database = createOrganizationMembershipDatabase();

    const member = await updateOrganizationMemberRole(database, VIEWER, {
      accountId: MEMBER_TWO_ID,
      organizationId: ORGANIZATION_ID,
      role: "admin",
    });

    expect(member).toMatchObject({
      accountId: MEMBER_TWO_ID,
      name: "Member Two",
      role: "admin",
      status: "active",
    });
  });

  test("returns status updates", async () => {
    const database = createOrganizationMembershipDatabase();

    const member = await setOrganizationMemberStatus(database, VIEWER, {
      accountId: MEMBER_TWO_ID,
      organizationId: ORGANIZATION_ID,
      status: "disabled",
    });

    expect(member).toMatchObject({
      accountId: MEMBER_TWO_ID,
      disabledByAccountId: "01J00000000000000000000001",
      name: "Member Two",
      status: "disabled",
    });
    expect(member.disabledAt).not.toBeNull();
  });

  test("removes members", async () => {
    const database = createOrganizationMembershipDatabase();
    const bindings = { DB: database } as ApiBindings;

    await removeOrganizationMember(bindings, VIEWER, ORGANIZATION_ID, MEMBER_TWO_ID);

    const member = await database
      .prepare(
        `
          SELECT account_id
          FROM organization_member
          WHERE organization_id = '${ORGANIZATION_ID}' AND account_id = '${MEMBER_TWO_ID}'
        `,
      )
      .first<{ account_id: string }>();

    expect(member).toBeNull();
  });
});
