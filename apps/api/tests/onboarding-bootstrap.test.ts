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
	      avatar_url text,
	      creator_account_id text,
	      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      slug text,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE UNIQUE INDEX app_slug_idx ON app (slug) WHERE slug IS NOT NULL;

    CREATE TABLE environment (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      description text NOT NULL,
      owner_account_id text,
      app_id text NOT NULL,
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
      app_id text NOT NULL,
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
	      avatar_url,
	      creator_account_id,
	      default_environment_id,
      created_at,
      updated_at
	    )
	    VALUES ('01J00000000000000000000006', 'Example Org', NULL, '01J00000000000000000000001', NULL, 1, 1);
  `);

  return database;
}

describe("onboarding bootstrap", () => {
  test("creates an organization and activates it for the viewer", async () => {
    const database = createOnboardingDatabase();

    const status = await bootstrapOnboarding(database, VIEWER, {
      name: "Created Org",
    });

    expect(status.completed).toBe(true);
    expect(status.organization).toMatchObject({
      name: "Created Org",
    });
    expect(status.organization).not.toHaveProperty("viewerRole");

    const account = await database
      .prepare("SELECT last_active_organization_id FROM account WHERE id = 'account-1'")
      .first<{ last_active_organization_id: string | null }>();

    expect(account?.last_active_organization_id).toBe(status.organization?.id);

    const app = await database
      .prepare("SELECT name, organization_id, owner_account_id FROM app WHERE organization_id = ?")
      .bind(status.organization?.id)
      .first<{
        name: string;
        organization_id: string;
        owner_account_id: string;
      }>();

    expect(app).toEqual({
      name: "Default App",
      organization_id: status.organization?.id,
      owner_account_id: VIEWER.id,
    });
  });
});
