import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  acceptOrganizationInvitation,
  cancelOrganizationInvitation,
  inviteOrganizationMember,
  listOrganizationInvitations,
} from "../src/modules/organizations/application/organization-invitations.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "invited@example.com",
  emailVerified: true,
  id: "account-2",
  imageUrl: null,
  name: "Invited User",
};

const OWNER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "account-1",
  imageUrl: null,
  name: "Owner",
};

function createInvitationDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      email text,
      email_verified integer,
      image_url text,
      last_active_organization_id text,
      name text NOT NULL,
      system_agent_model text,
      created_at integer,
      updated_at integer
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
      status text NOT NULL,
      reviewed_at integer,
      reviewed_by text,
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

    CREATE TABLE email_log (
      created_at integer NOT NULL,
      error_message text,
      id text PRIMARY KEY NOT NULL,
      provider text NOT NULL,
      recipient_domain text,
      recipient_masked text NOT NULL,
      status text NOT NULL,
      subject text NOT NULL,
      type text NOT NULL
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
      ('account-1', 'owner@example.com', 1, NULL, '01J00000000000000000000006', 'Owner', NULL, 1, 1),
      ('account-2', 'invited@example.com', 1, NULL, NULL, 'Invited User', NULL, 1, 1);

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
    VALUES ('01J00000000000000000000006', 'Team Org', 'team-org', 'team', 'auto', NULL, NULL, 'account-1', 1, 1);

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at,
      disabled_by_account_id,
      created_at,
      joined_at
    )
    VALUES ('01J00000000000000000000006', 'account-1', 'owner', NULL, NULL, 1, 1);

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
    VALUES ('invitation-1', '01J00000000000000000000006', 'invited@example.com', NULL, 'account-1', 'pending', 9999999999999, 1, 1);

    INSERT INTO organization_access_request (
      id,
      organization_id,
      requested_by_account_id,
      status,
      reviewed_at,
      reviewed_by,
      updated_at
    )
    VALUES ('request-1', '01J00000000000000000000006', 'account-2', 'pending', NULL, NULL, 1);
  `);

  return database;
}

function createBindings(database: D1Database): ApiBindings {
  return {
    AUTH_EMAIL_FROM: "Auth <auth@example.com>",
    DB: database,
    WEB_ORIGIN: "https://app.example.com",
  } as ApiBindings;
}

describe("organization invitations", () => {
  test("creates invitations", async () => {
    const database = createInvitationDatabase();
    database.execute("DELETE FROM organization_invitation");

    const invitation = await inviteOrganizationMember(
      createBindings(database),
      OWNER,
      "new@example.com",
      "01J00000000000000000000006",
    );

    expect(invitation).toMatchObject({
      email: "new@example.com",
      invitedBy: "account-1",
      invitedByName: "Owner",
      organizationId: "01J00000000000000000000006",
      organizationName: "Team Org",
      status: "pending",
    });

    const storedInvitation = await database
      .prepare(
        `
          SELECT email, invited_by, status
          FROM organization_invitation
          WHERE id = ?
        `,
      )
      .bind(invitation.id)
      .first<{ email: string; invited_by: string; status: string }>();

    expect(storedInvitation).toEqual({
      email: "new@example.com",
      invited_by: "account-1",
      status: "pending",
    });
  });

  test("cancels invitations", async () => {
    const database = createInvitationDatabase();

    const invitation = await cancelOrganizationInvitation(database, OWNER, {
      invitationId: "invitation-1",
    });

    expect(invitation).toMatchObject({
      accountId: "account-1",
      email: "invited@example.com",
      id: "invitation-1",
      invitedByName: "Owner",
      organizationId: "01J00000000000000000000006",
      status: "cancelled",
    });

    const storedInvitation = await database
      .prepare(
        `
          SELECT account_id, status
          FROM organization_invitation
          WHERE id = ?
        `,
      )
      .bind(invitation.id)
      .first<{ account_id: string; status: string }>();

    expect(storedInvitation).toEqual({
      account_id: "account-1",
      status: "cancelled",
    });
  });

  test("lists pending invitations for permitted viewers", async () => {
    const database = createInvitationDatabase();

    const invitations = await listOrganizationInvitations(
      database,
      OWNER,
      "01J00000000000000000000006",
    );

    expect(invitations).toHaveLength(1);
    expect(invitations[0]).toMatchObject({
      email: "invited@example.com",
      id: "invitation-1",
      invitedByName: "Owner",
      organizationId: "01J00000000000000000000006",
      status: "pending",
    });
  });

  test("returns empty pending invitation lists", async () => {
    const database = createInvitationDatabase();
    database.execute("DELETE FROM organization_invitation");

    const invitations = await listOrganizationInvitations(
      database,
      OWNER,
      "01J00000000000000000000006",
    );

    expect(invitations).toEqual([]);
  });

  test("accepts an invitation", async () => {
    const database = createInvitationDatabase();

    const summary = await acceptOrganizationInvitation(database, VIEWER, {
      invitationId: "invitation-1",
    });

    expect(summary).toMatchObject({
      id: "01J00000000000000000000006",
      name: "Team Org",
      viewerRole: "member",
    });

    const account = await database
      .prepare("SELECT last_active_organization_id FROM account WHERE id = 'account-2'")
      .first<{ last_active_organization_id: string | null }>();
    const invitation = await database
      .prepare("SELECT account_id, status FROM organization_invitation WHERE id = 'invitation-1'")
      .first<{ account_id: string | null; status: string }>();

    expect(account?.last_active_organization_id).toBe("01J00000000000000000000006");
    expect(invitation).toEqual({
      account_id: "account-2",
      status: "accepted",
    });
  });
});
