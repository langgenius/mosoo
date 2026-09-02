import { describe, expect, test } from "bun:test";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { createProject } from "../src/modules/projects/application/project-provisioning.service";
import {
  ensureProjectOwnership,
  listOrganizationProjects,
} from "../src/modules/projects/application/project.service";
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

    CREATE TABLE project (
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
    name: "Project Owner",
  };
}

describe("Project provisioning boundary", () => {
  test("lists only Projects owned by the Organization owner", async () => {
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

      INSERT INTO project (
        id,
        organization_id,
        owner_account_id,
        name,
        default_environment_id,
        created_at,
        updated_at
      )
      VALUES
        ('project-1', 'org-1', 'account-1', 'Default Project', 'env-1', 1, 1),
        ('project-2', 'org-1', 'account-2', 'Foreign Project', NULL, 2, 2);
    `);

    const projects = await listOrganizationProjects(database, makeViewer("account-1"), "org-1");

    expect(projects).toEqual([
      {
        createdAt: "1970-01-01T00:00:00.001Z",
        defaultEnvironmentId: "env-1",
        id: "project-1",
        name: "Default Project",
        ownerAccountId: "account-1",
      },
    ]);
  });

  test("rejects Project access when the viewer is not the Project owner", async () => {
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

      INSERT INTO project (
        id,
        organization_id,
        owner_account_id,
        name,
        default_environment_id,
        created_at,
        updated_at
      )
      VALUES ('project-1', 'org-1', 'account-1', 'Default Project', NULL, 1, 1);
    `);

    await expect(ensureProjectOwnership(database, "account-2", "project-1")).rejects.toThrow(
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

    await expect(
      listOrganizationProjects(database, makeViewer("account-1"), "org-1"),
    ).rejects.toThrow("Organization owner could not be resolved.");
  });

  test("createProject fails closed when the viewer does not own the Organization", async () => {
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
      createProject({ DB: database }, makeViewer("account-2"), {
        name: "New Project",
        organizationId: "org-1",
      }),
    ).rejects.toThrow();

    const projects = await listOrganizationProjects(database, makeViewer("account-1"), "org-1");
    expect(projects).toEqual([]);
  });
});
