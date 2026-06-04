import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { discoverOrganizations } from "../src/modules/onboarding/application/onboarding.service";
import { currentTimestampMs } from "../src/time";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "new@example.com",
  emailVerified: true,
  id: "account-1",
  imageUrl: null,
  name: "New User",
};

function createOnboardingDiscoveryDatabase(
  input: { accountCreatedAt?: number } = {},
): SqliteD1Database {
  const database = new SqliteD1Database();
  const now = currentTimestampMs();
  const accountCreatedAt = input.accountCreatedAt ?? now;

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
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE organization_domain (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      domain text NOT NULL,
      status text NOT NULL,
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
      ('account-1', 'new@example.com', 1, NULL, NULL, 'New User', NULL, ${accountCreatedAt}, ${now}),
      ('01J00000000000000000000001', '01J00000000000000000000001@example.com', 1, NULL, NULL, 'Owner One', NULL, 1, 1),
      ('owner-2', 'owner-2@example.com', 1, NULL, NULL, 'Owner Two', NULL, 1, 1);

    INSERT INTO organization (
      id,
      name,
      slug,
      join_policy,
      primary_domain,
      avatar_url,
      creator_account_id,
      default_environment_id,
      created_at,
      updated_at
    )
    VALUES
      (
        'org-primary',
        'Primary Domain Org',
        'primary-domain-org',
        'auto',
        'example.com',
        NULL,
        '01J00000000000000000000001',
        NULL,
        1,
        1
      ),
      (
        'org-active-domain',
        'Active Domain Org',
        'active-domain-org',
        'invite_only',
        NULL,
        NULL,
        'owner-2',
        NULL,
        2,
        2
      ),
      (
        'org-personal',
        'Personal Org',
        'personal-org',
        'invite_only',
        NULL,
        NULL,
        '01J00000000000000000000001',
        NULL,
        3,
        3
      );

    INSERT INTO organization_domain (
      id,
      organization_id,
      domain,
      status,
      created_at,
      updated_at
    )
    VALUES
      ('domain-extra', 'org-primary', 'other.example.com', 'pending', 1, 1),
      ('domain-active', 'org-active-domain', 'example.com', 'active', 1, 1);

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
      ('org-primary', '01J00000000000000000000001', 'owner', NULL, NULL, 1, 1),
      ('org-primary', '01J00000000000000000000002', 'member', NULL, NULL, 1, 1),
      ('org-primary', 'member-disabled', 'member', 2, '01J00000000000000000000001', 1, 1),
      ('org-active-domain', 'owner-2', 'owner', NULL, NULL, 1, 1);
  `);

  return database;
}

describe("onboarding discovery", () => {
  test("discovers domain organizations with member counts", async () => {
    const database = createOnboardingDiscoveryDatabase();

    const discovery = await discoverOrganizations(database, VIEWER);

    expect(discovery).toEqual({
      domain: "example.com",
      isPublicEmail: false,
      orgs: [
        {
          creator: "Owner One",
          id: "org-primary",
          joinPolicy: "auto",
          memberCount: 2,
          name: "Primary Domain Org",
        },
        {
          creator: "Owner Two",
          id: "org-active-domain",
          joinPolicy: "invite_only",
          memberCount: 1,
          name: "Active Domain Org",
        },
      ],
    });
  });

  test("returns no discovery candidates for older accounts", async () => {
    const database = createOnboardingDiscoveryDatabase({
      accountCreatedAt: currentTimestampMs() - 31_000,
    });

    const discovery = await discoverOrganizations(database, VIEWER);

    expect(discovery).toEqual({
      domain: "example.com",
      isPublicEmail: false,
      orgs: [],
    });
  });
});
