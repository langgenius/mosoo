import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { renameProject } from "../src/modules/projects/application/project.service";
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

    CREATE TABLE project (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      name text NOT NULL,
      slug text NOT NULL,
      default_environment_id text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

    CREATE UNIQUE INDEX project_organization_slug_idx ON project (organization_id, slug);
  `);

  database.execute(`
    INSERT INTO organization (id, name, slug, creator_account_id, created_at, updated_at)
    VALUES ('org-1', 'Org One', 'org-one', 'account-1', 1, 1);

    INSERT INTO project (
      id, organization_id, owner_account_id, name, slug, default_environment_id, created_at, updated_at
    )
    VALUES ('project-1', 'org-1', 'account-1', 'Default Project', 'default', 'env-1', 1, 1);
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

describe("renameProject", () => {
  test("renames a Project owned by the viewer", async () => {
    const database = createDatabase();

    const renamed = await renameProject(database, makeViewer("account-1"), {
      projectId: "project-1",
      name: "  Production  ",
    });

    expect(renamed.name).toBe("Production");
    expect(renamed.id).toBe("project-1");
  });

  test("rejects a blank name", async () => {
    const database = createDatabase();

    await expect(
      renameProject(database, makeViewer("account-1"), { projectId: "project-1", name: "   " }),
    ).rejects.toThrow("Project name is required.");
  });

  test("forbids renaming a Project the viewer does not own", async () => {
    const database = createDatabase();

    await expect(
      renameProject(database, makeViewer("account-2"), {
        projectId: "project-1",
        name: "Hijacked",
      }),
    ).rejects.toThrow();
  });
});
