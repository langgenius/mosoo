import { describe, expect, test } from "bun:test";

import { renameApp } from "../src/modules/apps/application/app.service";
import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { renameOrganization } from "../src/modules/organizations/application/organization.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createDatabase(): SqliteD1Database {
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

  database.execute(`
    INSERT INTO organization (id, name, slug, creator_account_id, created_at, updated_at)
    VALUES ('org-1', 'Org One', 'org-one', 'account-1', 1, 1);

    INSERT INTO app (
      id, organization_id, owner_account_id, name, slug, default_environment_id, created_at, updated_at
    )
    VALUES ('app-1', 'org-1', 'account-1', 'Default App', 'default', 'env-1', 1, 1);
  `);

  return database;
}

function makeViewer(id: string): AuthenticatedViewer {
  return {
    email: `${id}@example.com`,
    emailVerified: true,
    id,
    imageUrl: null,
    name: "Owner",
  };
}

describe("renameApp", () => {
  test("renames an App owned by the viewer", async () => {
    const database = createDatabase();

    const renamed = await renameApp(database, makeViewer("account-1"), {
      appId: "app-1",
      name: "  Production  ",
    });

    expect(renamed.name).toBe("Production");
    expect(renamed.id).toBe("app-1");
  });

  test("rejects a blank name", async () => {
    const database = createDatabase();

    await expect(
      renameApp(database, makeViewer("account-1"), { appId: "app-1", name: "   " }),
    ).rejects.toThrow("App name is required.");
  });

  test("forbids renaming an App the viewer does not own", async () => {
    const database = createDatabase();

    await expect(
      renameApp(database, makeViewer("account-2"), { appId: "app-1", name: "Hijacked" }),
    ).rejects.toThrow();
  });
});

describe("renameOrganization", () => {
  test("renames an Organization owned by the viewer", async () => {
    const database = createDatabase();

    const renamed = await renameOrganization(database, makeViewer("account-1"), {
      organizationId: "org-1",
      name: "  Acme  ",
    });

    expect(renamed.name).toBe("Acme");
    expect(renamed.id).toBe("org-1");
  });

  test("rejects a blank name", async () => {
    const database = createDatabase();

    await expect(
      renameOrganization(database, makeViewer("account-1"), {
        organizationId: "org-1",
        name: "   ",
      }),
    ).rejects.toThrow("Organization name is required.");
  });

  test("forbids renaming an Organization the viewer does not own", async () => {
    const database = createDatabase();

    await expect(
      renameOrganization(database, makeViewer("account-2"), {
        organizationId: "org-1",
        name: "Hijacked",
      }),
    ).rejects.toThrow();
  });
});
