import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { bootstrapOnboarding } from "../src/modules/onboarding/application/onboarding.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const VIEWER: AuthenticatedViewer = {
  email: "new@example.com",
  emailVerified: true,
  id: "account-1",
  imageUrl: null,
  name: "New User",
};

function createOnboardingDatabase(): SqliteD1Database {
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
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE UNIQUE INDEX organization_slug_idx ON organization (slug);

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

    CREATE TABLE environment (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      description text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text,
      current_revision_id text NOT NULL,
      forked_from_environment_id text,
      forked_from_environment_name text,
      forked_from_owner_name text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE environment_revision (
      id text PRIMARY KEY NOT NULL,
      environment_id text NOT NULL,
      organization_id text NOT NULL,
      network_policy text NOT NULL,
      allow_mcp_servers integer NOT NULL,
      allow_package_managers integer NOT NULL,
      allowed_hosts_json text NOT NULL,
      packages_json text NOT NULL,
      setup_script text NOT NULL,
      env_vars_json text NOT NULL,
      created_by_account_id text,
      created_at integer NOT NULL
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
    VALUES ('account-1', 'new@example.com', 1, NULL, NULL, 'New User', NULL, 1, 1);

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
    VALUES ('01J00000000000000000000006', 'Example Org', 'example-org', 'auto', 'example.com', NULL, '01J00000000000000000000001', NULL, 1, 1);
  `);

  return database;
}

describe("onboarding bootstrap", () => {
  test("creates an organization and activates it for the viewer", async () => {
    const database = createOnboardingDatabase();

    const status = await bootstrapOnboarding(database, VIEWER, {
      action: "create",
      name: "Created Org",
    });

    expect(status.completed).toBe(true);
    expect(status.organization).toMatchObject({
      joinPolicy: "auto",
      name: "Created Org",
      primaryDomain: null,
      slug: "created-org",
      viewerRole: "owner",
    });

    const account = await database
      .prepare("SELECT last_active_organization_id FROM account WHERE id = 'account-1'")
      .first<{ last_active_organization_id: string | null }>();

    expect(account?.last_active_organization_id).toBe(status.organization?.id);
  });

  test("creates the next slug candidate when the base slug exists", async () => {
    const database = createOnboardingDatabase();
    database.execute(`
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
      VALUES (
        'org-slug-collision',
        'Created Org',
        'created-org',
        'auto',
        NULL,
        NULL,
        'owner-2',
        NULL,
        1,
        1
      );
    `);
    const status = await bootstrapOnboarding(database, VIEWER, {
      action: "create",
      name: "Created Org",
    });

    expect(status.completed).toBe(true);
    expect(status.organization).toMatchObject({
      name: "Created Org",
      slug: "created-org-2",
      viewerRole: "owner",
    });

    const createdRows = await database
      .prepare("SELECT id FROM organization WHERE creator_account_id = 'account-1' ORDER BY slug")
      .all<{ id: string }>();

    expect(createdRows.results).toEqual([{ id: status.organization?.id }]);
  });

  test("joins a discovered organization", async () => {
    const database = createOnboardingDatabase();

    const status = await bootstrapOnboarding(database, VIEWER, {
      action: "join",
      organizationId: "01J00000000000000000000006",
    });

    expect(status.completed).toBe(true);
    expect(status.organization?.id).toBe("01J00000000000000000000006");
    expect(status.organization?.viewerRole).toBe("member");

    const account = await database
      .prepare("SELECT last_active_organization_id FROM account WHERE id = 'account-1'")
      .first<{ last_active_organization_id: string | null }>();

    expect(account?.last_active_organization_id).toBe("01J00000000000000000000006");
  });

  test("keeps completed onboarding when joining again", async () => {
    const database = createOnboardingDatabase();
    database.execute(`
      INSERT INTO organization_member (
        organization_id,
        account_id,
        role,
        disabled_at,
        disabled_by_account_id,
        created_at,
        joined_at
      )
      VALUES ('01J00000000000000000000006', 'account-1', 'member', NULL, NULL, 1, 1);
    `);
    const status = await bootstrapOnboarding(database, VIEWER, {
      action: "join",
      organizationId: "missing-org",
    });

    expect(status.completed).toBe(true);
    expect(status.organization?.id).toBe("01J00000000000000000000006");
  });
});
