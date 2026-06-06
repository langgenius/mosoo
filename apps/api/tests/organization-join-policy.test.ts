import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { updateJoinPolicy } from "../src/modules/organizations/application/organization-members.service";
import {
  updateOrganizationPrimaryDomain,
  updateOrganizationProfile,
} from "../src/modules/organizations/application/organization.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const CLAIMED_ORGANIZATION_ID = "01J000000000000000000000K1";
const ORGANIZATION_ID = "01J00000000000000000000006";
const VIEWER_ID = "01J000000000000000000000K3";

const VIEWER: AuthenticatedViewer = {
  email: "owner@example.com",
  emailVerified: true,
  id: VIEWER_ID,
  imageUrl: null,
  name: "Owner",
};

function createOrganizationJoinPolicyDatabase(): SqliteD1Database {
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
      join_policy text NOT NULL,
      primary_domain text,
      avatar_url text,
      creator_account_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE UNIQUE INDEX organization_primary_domain_idx ON organization (primary_domain);

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
    VALUES ('${VIEWER_ID}', 'owner@example.com', 1, NULL, '${ORGANIZATION_ID}', 'Owner', NULL, 1, 1);

    INSERT INTO organization (
      id,
      name,
      slug,
      join_policy,
      primary_domain,
      avatar_url,
      creator_account_id,
      created_at,
      updated_at
    )
    VALUES ('${ORGANIZATION_ID}', 'Team Org', 'team-org', 'auto', NULL, NULL, '${VIEWER_ID}', 1, 1);

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at,
      disabled_by_account_id,
      created_at,
      joined_at
    )
    VALUES ('${ORGANIZATION_ID}', '${VIEWER_ID}', 'owner', NULL, NULL, 1, 1);
  `);

  return database;
}

describe("organization settings updates", () => {
  test("returns join policy updates for any owned organization", async () => {
    const database = createOrganizationJoinPolicyDatabase();
    const summary = await updateJoinPolicy(database, VIEWER, {
      joinPolicy: "invite_only",
      organizationId: ORGANIZATION_ID,
    });

    expect(summary).toMatchObject({
      joinPolicy: "invite_only",
    });
  });

  test("returns profile updates from the updated organization row", async () => {
    const database = createOrganizationJoinPolicyDatabase();

    const summary = await updateOrganizationProfile(database, VIEWER, {
      avatarUrl: "https://assets.example.test/org.png",
      name: "Renamed Org",
      organizationId: ORGANIZATION_ID,
    });

    expect(summary).toMatchObject({
      avatarUrl: "https://assets.example.test/org.png",
      id: ORGANIZATION_ID,
      name: "Renamed Org",
      viewerRole: "owner",
    });
  });

  test("returns primary domain updates", async () => {
    const database = createOrganizationJoinPolicyDatabase();

    const summary = await updateOrganizationPrimaryDomain(database, VIEWER, {
      domain: "Acme.test",
      organizationId: ORGANIZATION_ID,
    });

    expect(summary).toMatchObject({
      id: ORGANIZATION_ID,
      primaryDomain: "acme.test",
      viewerRole: "owner",
    });
  });

  test("uses the primary-domain unique index for conflict admission", async () => {
    const database = createOrganizationJoinPolicyDatabase();
    database.execute(`
      INSERT INTO organization (
        id,
        name,
        slug,
        join_policy,
        primary_domain,
        avatar_url,
        creator_account_id,
        created_at,
        updated_at
      )
      VALUES ('${CLAIMED_ORGANIZATION_ID}', 'Claimed Org', 'claimed-org', 'auto', 'acme.test', NULL, '${VIEWER_ID}', 2, 2);
    `);
    await expect(
      updateOrganizationPrimaryDomain(database, VIEWER, {
        domain: "Acme.test",
        organizationId: ORGANIZATION_ID,
      }),
    ).rejects.toThrow();
  });
});

describe("former personal organization behavior", () => {
  test("claims a primary domain without conversion", async () => {
    const database = createOrganizationJoinPolicyDatabase();
    database.execute(`
      UPDATE organization
      SET join_policy = 'invite_only'
      WHERE id = '${ORGANIZATION_ID}';
    `);

    const summary = await updateOrganizationPrimaryDomain(database, VIEWER, {
      domain: "Acme.test",
      organizationId: ORGANIZATION_ID,
    });

    expect(summary).toMatchObject({
      id: ORGANIZATION_ID,
      joinPolicy: "invite_only",
      primaryDomain: "acme.test",
      viewerRole: "owner",
    });
  });
});
