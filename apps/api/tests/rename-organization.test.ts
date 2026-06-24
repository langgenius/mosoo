import { describe, expect, test } from "bun:test";

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
  `);

  database.execute(`
    INSERT INTO organization (id, name, slug, creator_account_id, created_at, updated_at)
    VALUES ('org-1', 'Org One', 'org-one', 'account-1', 1, 1);
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

describe("renameOrganization", () => {
  test("renames an organization owned by the viewer", async () => {
    const database = createDatabase();

    const renamed = await renameOrganization(database, makeViewer("account-1"), {
      organizationId: "org-1",
      name: "  Acme Inc  ",
    });

    expect(renamed.name).toBe("Acme Inc");
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

  test("forbids renaming an organization the viewer does not own", async () => {
    const database = createDatabase();

    await expect(
      renameOrganization(database, makeViewer("account-2"), {
        organizationId: "org-1",
        name: "Hijacked",
      }),
    ).rejects.toThrow();
  });
});
