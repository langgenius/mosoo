import { describe, expect, test } from "bun:test";

import { parsePlatformId } from "@mosoo/id";
import type { AccountId, EnvironmentId, OrganizationId, ProjectId } from "@mosoo/id";

import { ensureEnvironmentAccess } from "../src/modules/environments/application/environment-access.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_ID = parsePlatformId<AccountId>("01J00000000000000000000001", "owner ID");
const OTHER_ACCOUNT_ID = parsePlatformId<AccountId>(
  "01J00000000000000000000002",
  "other account ID",
);
const ORGANIZATION_ID = parsePlatformId<OrganizationId>(
  "01J00000000000000000000006",
  "organization ID",
);
const PROJECT_ID = parsePlatformId<ProjectId>("01J00000000000000000000009", "project ID");
const OTHER_PROJECT_ID = parsePlatformId<ProjectId>(
  "01J0000000000000000000000A",
  "other project ID",
);
const PROJECT_ENVIRONMENT_ID = parsePlatformId<EnvironmentId>(
  "01J0000000000000000000000B",
  "Project environment ID",
);
const BUILT_IN_ENVIRONMENT_ID = parsePlatformId<EnvironmentId>(
  "01J0000000000000000000000C",
  "built-in environment ID",
);

function createEnvironmentAccessDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      image_url text
    );

    CREATE TABLE organization (
      id text PRIMARY KEY NOT NULL
    );

    CREATE TABLE project (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE environment (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      description text NOT NULL,
      project_id text NOT NULL,
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
      project_id text NOT NULL,
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

    CREATE TABLE agent (
      environment_id text,
      project_id text
    );
  `);

  database
    .prepare(
      `
        INSERT INTO account (id, name, image_url)
        VALUES (?, 'Owner', NULL), (?, 'Other', NULL)
      `,
    )
    .bind(OWNER_ID, OTHER_ACCOUNT_ID)
    .run();

  database.prepare("INSERT INTO organization (id) VALUES (?)").bind(ORGANIZATION_ID).run();

  database
    .prepare(
      `
        INSERT INTO project (
          id,
          organization_id,
          owner_account_id,
          name,
          default_environment_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, 'Default Project', ?, 1, 1)
      `,
    )
    .bind(PROJECT_ID, ORGANIZATION_ID, OWNER_ID, BUILT_IN_ENVIRONMENT_ID)
    .run();

  database
    .prepare(
      `
        INSERT INTO environment (
          id,
          name,
          description,
          project_id,
          owner_account_id,
          current_revision_id,
          forked_from_environment_id,
          forked_from_environment_name,
          forked_from_owner_name,
          created_at,
          updated_at
        )
        VALUES
          (?, 'Project Local', '', ?, ?, 'rev-project', NULL, NULL, NULL, 1, 1),
          (?, 'System Default', '', ?, NULL, 'rev-built-in', NULL, NULL, NULL, 1, 1)
      `,
    )
    .bind(PROJECT_ENVIRONMENT_ID, PROJECT_ID, OWNER_ID, BUILT_IN_ENVIRONMENT_ID, PROJECT_ID)
    .run();

  database
    .prepare(
      `
        INSERT INTO environment_revision (
          id,
          environment_id,
          project_id,
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
          ('rev-project', ?, ?, 'full', 1, 1, '[]', '[]', '', '[]', ?, 1),
          ('rev-built-in', ?, ?, 'full', 1, 1, '[]', '[]', '', '[]', NULL, 1)
      `,
    )
    .bind(PROJECT_ENVIRONMENT_ID, PROJECT_ID, OWNER_ID, BUILT_IN_ENVIRONMENT_ID, PROJECT_ID)
    .run();

  return database;
}

describe("environment access", () => {
  test("allows the Project owner to read Project-local environments", async () => {
    const database = createEnvironmentAccessDatabase();

    const access = await ensureEnvironmentAccess(database, OWNER_ID, {
      environmentId: PROJECT_ENVIRONMENT_ID,
      projectId: PROJECT_ID,
    });

    expect(access.row.id).toBe(PROJECT_ENVIRONMENT_ID);
    expect(access.row.projectId).toBe(PROJECT_ID);
  });

  test("allows the Project owner to read the Project default built-in environment", async () => {
    const database = createEnvironmentAccessDatabase();

    const access = await ensureEnvironmentAccess(database, OWNER_ID, {
      environmentId: BUILT_IN_ENVIRONMENT_ID,
      projectId: PROJECT_ID,
    });

    expect(access.row.ownerId).toBeNull();
    expect(access.row.defaultEnvironmentId).toBe(BUILT_IN_ENVIRONMENT_ID);
  });

  test("fails closed when the viewer is not the Project owner", async () => {
    const database = createEnvironmentAccessDatabase();

    await expect(
      ensureEnvironmentAccess(database, OTHER_ACCOUNT_ID, {
        environmentId: PROJECT_ENVIRONMENT_ID,
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow("Environment not found.");
  });

  test("fails closed when the environment is requested through another Project", async () => {
    const database = createEnvironmentAccessDatabase();

    await expect(
      ensureEnvironmentAccess(database, OWNER_ID, {
        environmentId: PROJECT_ENVIRONMENT_ID,
        projectId: OTHER_PROJECT_ID,
      }),
    ).rejects.toThrow("Environment not found.");
  });
});
