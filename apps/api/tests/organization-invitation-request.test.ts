import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { requestOrganizationInvitation } from "../src/modules/organizations/application/organization-access-requests.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "member@example.com",
  emailVerified: true,
  id: "01J00000000000000000000002",
  imageUrl: null,
  name: "Member",
};

function createInvitationRequestDatabase(
  options: { includePendingRequest?: boolean } = {},
): SqliteD1Database {
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
      invited_by text NOT NULL,
      account_id text,
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
      ('01J00000000000000000000002', 'member@example.com', 1, NULL, '01J00000000000000000000006', 'Member', NULL, 1, 1),
      ('invitee-1', 'invitee@example.com', 1, NULL, NULL, 'Invitee', NULL, 1, 1);

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
    VALUES ('01J00000000000000000000006', 'Example Org', 'example-org', 'team', 'auto', NULL, NULL, '01J00000000000000000000001', 1, 1);

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

  if (options.includePendingRequest === true) {
    database.execute(`
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
        'invitee-1',
        'invitee@example.com',
        '01J00000000000000000000002',
        NULL,
        NULL,
        'pending',
        2,
        2
      );
    `);
  }

  return database;
}

describe("organization invitation requests", () => {
  test("creates an invitation request for an invitee", async () => {
    const database = createInvitationRequestDatabase();

    const request = await requestOrganizationInvitation(database, VIEWER, {
      email: "invitee@example.com",
      organizationId: "01J00000000000000000000006",
    });

    expect(request.organizationId).toBe("01J00000000000000000000006");
    expect(request.organizationName).toBe("Example Org");
    expect(request.referrerAccountId).toBe("01J00000000000000000000002");
    expect(request.referrerName).toBe("Member");
    expect(request.requestedByAccountId).toBe("invitee-1");
    expect(request.requesterName).toBe("Invitee");
    expect(request.status).toBe("pending");
  });

  test("returns an existing invitee request", async () => {
    const database = createInvitationRequestDatabase({ includePendingRequest: true });

    const request = await requestOrganizationInvitation(database, VIEWER, {
      email: "invitee@example.com",
      organizationId: "01J00000000000000000000006",
    });

    expect(request).toMatchObject({
      id: "request-1",
      organizationId: "01J00000000000000000000006",
      referrerAccountId: "01J00000000000000000000002",
      requestedByAccountId: "invitee-1",
      requesterEmail: "invitee@example.com",
      requesterName: "Invitee",
      status: "pending",
    });
  });
});
