import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import {
  listOrganizationAccessRequests,
  requestOrganizationAccess,
  reviewOrganizationAccessRequest,
} from "../src/modules/organizations/application/organization-access-requests.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: "01J00000000000000000000001",
  imageUrl: null,
  name: "Owner",
};

const REQUESTER: AuthenticatedViewer = {
  email: "requester@example.com",
  emailVerified: true,
  id: "requester-1",
  imageUrl: null,
  name: "Requester",
};

function createAccessRequestDatabase(
  options: { includePendingRequest?: boolean } = {},
): SqliteD1Database {
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

    CREATE TABLE organization_domain (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      domain text NOT NULL,
      status text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
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
      ('01J00000000000000000000001', 'owner@example.com', 1, NULL, '01J00000000000000000000006', 'Owner', NULL, 1, 1),
      ('requester-1', 'requester@example.com', 1, NULL, NULL, 'Requester', NULL, 1, 1);

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
    VALUES ('01J00000000000000000000006', 'Example Org', 'example-org', 'team', 'invite_only', 'example.com', NULL, '01J00000000000000000000001', 1, 1);

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
  `);

  if (options.includePendingRequest ?? true) {
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
    VALUES ('request-1', '01J00000000000000000000006', 'requester-1', 'requester@example.com', NULL, NULL, NULL, 'pending', 1, 1);
  `);
  }

  return database;
}

function createBindings(database: D1Database): ApiBindings {
  return {
    AUTH_EMAIL_FROM: "Auth <auth@example.com>",
    DB: database,
  } as ApiBindings;
}

describe("organization access request review", () => {
  test("returns submitted requests", async () => {
    const database = createAccessRequestDatabase({ includePendingRequest: false });

    const request = await requestOrganizationAccess(database, REQUESTER, {
      organizationId: "01J00000000000000000000006",
    });

    expect(request).toMatchObject({
      organizationId: "01J00000000000000000000006",
      organizationName: "Example Org",
      referrerAccountId: null,
      referrerName: null,
      requestedByAccountId: "requester-1",
      requesterEmail: "requester@example.com",
      requesterName: "Requester",
      status: "pending",
    });
  });

  test("returns existing submitted requests", async () => {
    const database = createAccessRequestDatabase();

    const request = await requestOrganizationAccess(database, REQUESTER, {
      organizationId: "01J00000000000000000000006",
    });

    expect(request).toMatchObject({
      id: "request-1",
      organizationId: "01J00000000000000000000006",
      organizationName: "Example Org",
      requestedByAccountId: "requester-1",
      requesterEmail: "requester@example.com",
      requesterName: "Requester",
      status: "pending",
    });
  });

  test("lists pending requests for permitted viewers", async () => {
    const database = createAccessRequestDatabase();

    const requests = await listOrganizationAccessRequests(
      database,
      VIEWER,
      "01J00000000000000000000006",
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      id: "request-1",
      organizationId: "01J00000000000000000000006",
      requesterEmail: "requester@example.com",
      status: "pending",
    });
  });

  test("returns empty pending request lists", async () => {
    const database = createAccessRequestDatabase({ includePendingRequest: false });

    const requests = await listOrganizationAccessRequests(
      database,
      VIEWER,
      "01J00000000000000000000006",
    );

    expect(requests).toEqual([]);
  });

  test("returns approved requests and creates membership", async () => {
    const database = createAccessRequestDatabase();

    const request = await reviewOrganizationAccessRequest(createBindings(database), VIEWER, {
      decision: "approve",
      requestId: "request-1",
    });

    expect(request).toMatchObject({
      id: "request-1",
      organizationId: "01J00000000000000000000006",
      reviewedBy: "01J00000000000000000000001",
      reviewedByName: "Owner",
      status: "approved",
    });
    expect(request.reviewedAt).not.toBeNull();

    const member = await database
      .prepare(
        `
          SELECT role
          FROM organization_member
          WHERE organization_id = '01J00000000000000000000006' AND account_id = 'requester-1'
        `,
      )
      .first<{ role: string }>();

    expect(member?.role).toBe("member");
  });

  test("returns rejected requests", async () => {
    const database = createAccessRequestDatabase();

    const request = await reviewOrganizationAccessRequest(createBindings(database), VIEWER, {
      decision: "reject",
      requestId: "request-1",
    });

    expect(request).toMatchObject({
      id: "request-1",
      reviewedBy: "01J00000000000000000000001",
      reviewedByName: "Owner",
      status: "rejected",
    });
    expect(request.reviewedAt).not.toBeNull();
  });
});
