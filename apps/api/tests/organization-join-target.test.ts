import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { getOrganizationJoinTarget } from "../src/modules/organizations/application/organization-join-target.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "member@example.com",
  emailVerified: true,
  id: "01J00000000000000000000002",
  imageUrl: null,
  name: "Member",
};

function createOrganizationJoinTargetDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

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
      name text NOT NULL,
      slug text NOT NULL,
      kind text DEFAULT 'team' NOT NULL,
      join_policy text NOT NULL,
      primary_domain text,
      avatar_url text,
      creator_account_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
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

    CREATE TABLE organization_invitation (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      email text NOT NULL,
      account_id text,
      invited_by text NOT NULL,
      status text NOT NULL,
      expires_at integer,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE organization_access_request (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      requested_by_account_id text NOT NULL,
      requester_email text NOT NULL,
      referrer_account_id text,
      reviewed_at integer,
      reviewed_by text,
      status text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
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
    VALUES ('01J00000000000000000000002', 'member@example.com', 1, NULL, '01J00000000000000000000006', 'Member', NULL, 1, 1);

    INSERT INTO organization (
      id,
      name,
      slug,
      kind,
      join_policy,
      primary_domain,
      avatar_url,
      creator_account_id,
      created_at,
      updated_at
    )
    VALUES ('01J00000000000000000000006', 'Team Org', 'team-org', 'team', 'invite_only', NULL, NULL, '01J00000000000000000000001', 1, 1);

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at,
      disabled_by_account_id,
      created_at,
      joined_at
    )
    VALUES ('01J00000000000000000000006', '01J00000000000000000000002', 'member', NULL, NULL, 1, 1);
  `);

  return database;
}

describe("organization join target", () => {
  test("derives active membership for the join target", async () => {
    const database = createOrganizationJoinTargetDatabase();

    const target = await getOrganizationJoinTarget(database, VIEWER, "01J00000000000000000000006");

    expect(target.viewerIsAuthenticated).toBe(true);
    expect(target.viewerIsMember).toBe(true);
    expect(target.organization.viewerRole).toBe("member");
    expect(target.pendingInvitation).toBeNull();
    expect(target.pendingRequest).toBeNull();
  });

  test("loads pending invitation and request for the join target", async () => {
    const database = createOrganizationJoinTargetDatabase();
    database.execute(`
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
      VALUES ('01J00000000000000000000001', 'owner@example.com', 1, NULL, '01J00000000000000000000006', 'Owner', NULL, 1, 1);

      INSERT INTO organization_invitation (
        id,
        organization_id,
        email,
        account_id,
        invited_by,
        status,
        expires_at,
        created_at,
        updated_at
      )
      VALUES (
        'invitation-1',
        '01J00000000000000000000006',
        'member@example.com',
        '01J00000000000000000000002',
        '01J00000000000000000000001',
        'pending',
        NULL,
        2,
        2
      );

      INSERT INTO organization_access_request (
        id,
        organization_id,
        requested_by_account_id,
        requester_email,
        referrer_account_id,
        reviewed_at,
        reviewed_by,
        status,
        created_at,
        updated_at
      )
      VALUES (
        'request-1',
        '01J00000000000000000000006',
        '01J00000000000000000000002',
        'member@example.com',
        '01J00000000000000000000001',
        NULL,
        NULL,
        'pending',
        3,
        3
      );
    `);
    const target = await getOrganizationJoinTarget(database, VIEWER, "01J00000000000000000000006");

    expect(target.pendingInvitation).toMatchObject({
      id: "invitation-1",
      invitedByName: "Owner",
      organizationName: "Team Org",
      status: "pending",
    });
    expect(target.pendingRequest).toMatchObject({
      id: "request-1",
      referrerName: "Owner",
      requesterName: "Member",
      status: "pending",
    });
  });
});
