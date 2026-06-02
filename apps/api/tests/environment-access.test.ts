import { describe, expect, test } from "bun:test";

import { ensureEnvironmentAccess } from "../src/modules/environments/application/environment-access.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createEnvironmentAccessDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE organization (
      id text PRIMARY KEY NOT NULL,
      default_environment_id text
    );

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      PRIMARY KEY (organization_id, account_id)
    );

    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      image_url text
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

    CREATE TABLE resource_acl (
      resource_type text NOT NULL,
      resource_id text NOT NULL,
      target_kind text NOT NULL,
      target_id text NOT NULL,
      role text NOT NULL,
      assigned_by_account_id text,
      created_at integer NOT NULL,
      PRIMARY KEY (resource_type, resource_id, target_kind, target_id)
    );

    CREATE TABLE agent (
      environment_id text
    );

    INSERT INTO organization (id, default_environment_id)
    VALUES ('01J00000000000000000000006', 'env-org-share');

    INSERT INTO organization_member (organization_id, account_id, role, disabled_at)
    VALUES
      ('01J00000000000000000000006', 'viewer-1', 'member', NULL),
      ('01J00000000000000000000006', 'admin-1', 'admin', NULL),
      ('01J00000000000000000000006', '01J00000000000000000000004', 'member', 10);

    INSERT INTO account (id, name, image_url)
    VALUES ('01J00000000000000000000001', 'Owner', NULL);

    INSERT INTO environment (
      id,
      name,
      description,
      organization_id,
      owner_account_id,
      current_revision_id,
      forked_from_environment_id,
      forked_from_environment_name,
      forked_from_owner_name,
      created_at,
      updated_at
    )
    VALUES
      ('env-org-share', 'Shared', '', '01J00000000000000000000006', '01J00000000000000000000001', 'rev-org-share', NULL, NULL, NULL, 1, 1),
      ('env-user-share', 'User Shared', '', '01J00000000000000000000006', '01J00000000000000000000001', 'rev-user-share', NULL, NULL, NULL, 1, 1),
      ('env-built-in', 'System Default', '', '01J00000000000000000000006', NULL, 'rev-built-in', NULL, NULL, NULL, 1, 1);

    INSERT INTO environment_revision (
      id,
      environment_id,
      organization_id,
      network_policy,
      allow_mcp_servers,
      allow_package_managers,
      allowed_hosts_json,
      packages_json,
      setup_script,
      env_vars_json,
      created_by_account_id,
      created_at
    )
    VALUES
      ('rev-org-share', 'env-org-share', '01J00000000000000000000006', 'full', 1, 1, '[]', '[]', '', '[]', '01J00000000000000000000001', 1),
      ('rev-user-share', 'env-user-share', '01J00000000000000000000006', 'full', 1, 1, '[]', '[]', '', '[]', '01J00000000000000000000001', 1),
      ('rev-built-in', 'env-built-in', '01J00000000000000000000006', 'full', 1, 1, '[]', '[]', '', '[]', NULL, 1);

    INSERT INTO resource_acl (
      resource_type,
      resource_id,
      target_kind,
      target_id,
      role,
      assigned_by_account_id,
      created_at
    )
    VALUES
      ('environment', 'env-org-share', 'organization', '01J00000000000000000000006', 'user', '01J00000000000000000000001', 1),
      ('environment', 'env-user-share', 'user', 'viewer-1', 'user', '01J00000000000000000000001', 1);
  `);

  return database;
}

describe("environment access", () => {
  test("resolves organization share access", async () => {
    const database = createEnvironmentAccessDatabase();

    const access = await ensureEnvironmentAccess(database, "viewer-1", "env-org-share");

    expect(access.hasOrganizationShare).toBe(true);
    expect(access.isOrganizationAdmin).toBe(false);
    expect(access.row.id).toBe("env-org-share");
  });

  test("keeps user share distinct from organization share", async () => {
    const database = createEnvironmentAccessDatabase();

    const access = await ensureEnvironmentAccess(database, "viewer-1", "env-user-share");

    expect(access.hasOrganizationShare).toBe(false);
    expect(access.row.id).toBe("env-user-share");
  });

  test("allows built-in environment for active organization members", async () => {
    const database = createEnvironmentAccessDatabase();

    const access = await ensureEnvironmentAccess(database, "viewer-1", "env-built-in");

    expect(access.row.ownerId).toBeNull();
  });
});
