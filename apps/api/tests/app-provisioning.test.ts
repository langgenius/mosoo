import { describe, expect, test } from "bun:test";

import {
  ensureAppOwnership,
  listOrganizationApps,
} from "../src/modules/apps/application/app.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createAppDatabase(): SqliteD1Database {
  const database = new SqliteD1Database();

  database.execute(`
	    CREATE TABLE organization (
	      id text PRIMARY KEY NOT NULL,
	      name text NOT NULL,
	      slug text NOT NULL,
	      avatar_url text,
	      creator_account_id text,
	      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      slug text NOT NULL,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE UNIQUE INDEX app_organization_slug_idx ON app (organization_id, slug);
  `);

  return database;
}

function makeViewer(id: string): AuthenticatedViewer {
  return {
    email: `${id}@example.com`,
    emailVerified: true,
    id,
    imageUrl: null,
    name: "App Owner",
  };
}

describe("App provisioning boundary", () => {
  test("lists only Apps owned by the Organization owner", async () => {
    const database = createAppDatabase();
    database.execute(`
      INSERT INTO organization (
	        id,
	        name,
	        slug,
	        creator_account_id,
	        created_at,
	        updated_at
	      )
	      VALUES ('org-1', 'Org One', 'org-one', 'account-1', 1, 1);

      INSERT INTO app (
        id,
        organization_id,
        owner_account_id,
        name,
        slug,
        default_environment_id,
        created_at,
        updated_at
      )
      VALUES
        ('app-1', 'org-1', 'account-1', 'Default App', 'default', 'env-1', 1, 1),
        ('app-2', 'org-1', 'account-2', 'Foreign App', 'foreign', NULL, 2, 2);
    `);

    const apps = await listOrganizationApps(database, makeViewer("account-1"), "org-1");

    expect(apps).toEqual([
      {
        createdAt: "1970-01-01T00:00:00.001Z",
        defaultEnvironmentId: "env-1",
        id: "app-1",
        name: "Default App",
        ownerAccountId: "account-1",
        slug: "default",
      },
    ]);
  });

  test("rejects App access when the viewer is not the App owner", async () => {
    const database = createAppDatabase();
    database.execute(`
      INSERT INTO organization (
	        id,
	        name,
	        slug,
	        creator_account_id,
	        created_at,
	        updated_at
	      )
	      VALUES ('org-1', 'Org One', 'org-one', 'account-1', 1, 1);

      INSERT INTO app (
        id,
        organization_id,
        owner_account_id,
        name,
        slug,
        default_environment_id,
        created_at,
        updated_at
      )
      VALUES ('app-1', 'org-1', 'account-1', 'Default App', 'default', NULL, 1, 1);
    `);

    await expect(ensureAppOwnership(database, "account-2", "app-1")).rejects.toThrow(
      "You do not have permission",
    );
  });

  test("fails closed when Organization ownership cannot be proven", async () => {
    const database = createAppDatabase();
    database.execute(`
      INSERT INTO organization (
	        id,
	        name,
	        slug,
	        creator_account_id,
	        created_at,
	        updated_at
	      )
	      VALUES ('org-1', 'Org One', 'org-one', NULL, 1, 1);
    `);

    await expect(listOrganizationApps(database, makeViewer("account-1"), "org-1")).rejects.toThrow(
      "Organization owner could not be resolved.",
    );
  });
});
