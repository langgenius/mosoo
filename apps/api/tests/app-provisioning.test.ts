import { describe, expect, test } from "bun:test";

import { createApp } from "../src/modules/apps/application/app-provisioning.service";
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
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );
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
	        creator_account_id,
	        created_at,
	        updated_at
	      )
	      VALUES ('org-1', 'Org One', 'account-1', 1, 1);

      INSERT INTO app (
        id,
        organization_id,
        owner_account_id,
        name,
        default_environment_id,
        created_at,
        updated_at
      )
      VALUES
        ('app-1', 'org-1', 'account-1', 'Default App', 'env-1', 1, 1),
        ('app-2', 'org-1', 'account-2', 'Foreign App', NULL, 2, 2);
    `);

    const apps = await listOrganizationApps(database, makeViewer("account-1"), "org-1");

    expect(apps).toEqual([
      {
        createdAt: "1970-01-01T00:00:00.001Z",
        defaultEnvironmentId: "env-1",
        id: "app-1",
        name: "Default App",
        ownerAccountId: "account-1",
      },
    ]);
  });

  test("rejects App access when the viewer is not the App owner", async () => {
    const database = createAppDatabase();
    database.execute(`
      INSERT INTO organization (
	        id,
	        name,
	        creator_account_id,
	        created_at,
	        updated_at
	      )
	      VALUES ('org-1', 'Org One', 'account-1', 1, 1);

      INSERT INTO app (
        id,
        organization_id,
        owner_account_id,
        name,
        default_environment_id,
        created_at,
        updated_at
      )
      VALUES ('app-1', 'org-1', 'account-1', 'Default App', NULL, 1, 1);
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
	        creator_account_id,
	        created_at,
	        updated_at
	      )
	      VALUES ('org-1', 'Org One', NULL, 1, 1);
    `);

    await expect(listOrganizationApps(database, makeViewer("account-1"), "org-1")).rejects.toThrow(
      "Organization owner could not be resolved.",
    );
  });

  test("createApp fails closed when the viewer does not own the Organization", async () => {
    const database = createAppDatabase();
    database.execute(`
      INSERT INTO organization (
	        id,
	        name,
	        creator_account_id,
	        created_at,
	        updated_at
	      )
	      VALUES ('org-1', 'Org One', 'account-1', 1, 1);
    `);

    await expect(
      createApp(database, makeViewer("account-2"), { name: "New App", organizationId: "org-1" }),
    ).rejects.toThrow();

    const apps = await listOrganizationApps(database, makeViewer("account-1"), "org-1");
    expect(apps).toEqual([]);
  });
});
