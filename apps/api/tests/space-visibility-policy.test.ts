import { describe, expect, test } from "bun:test";

import { updateSpaceVisibilityAfterCollaboratorChange } from "../src/modules/spaces/domain/space-visibility.policy";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createSpaceVisibilityDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE space (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      visibility text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
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

    INSERT INTO space (
      id,
      name,
      organization_id,
      owner_account_id,
      visibility,
      created_at,
      updated_at
    )
    VALUES ('space-1', 'Docs', '01J00000000000000000000006', '01J00000000000000000000001', 'shared', 1, 1);

    INSERT INTO resource_acl (
      resource_type,
      resource_id,
      target_kind,
      target_id,
      role,
      assigned_by_account_id,
      created_at
    )
    VALUES ('space', 'space-1', 'user', '01J00000000000000000000001', 'admin', '01J00000000000000000000001', 1);
  `);

  return database;
}

async function getSpaceVisibility(database: SqliteD1Database): Promise<string | null> {
  const row = await database
    .prepare("SELECT visibility FROM space WHERE id = 'space-1'")
    .first<{ visibility: string }>();

  return row?.visibility ?? null;
}

describe("space visibility policy", () => {
  test("marks owner-only ACL as private", async () => {
    const database = createSpaceVisibilityDatabase();

    await updateSpaceVisibilityAfterCollaboratorChange(database, "space-1");

    await expect(getSpaceVisibility(database)).resolves.toBe("private");
  });

  test("marks user collaborators as shared", async () => {
    const database = createSpaceVisibilityDatabase();

    database.execute(`
      INSERT INTO resource_acl (
        resource_type,
        resource_id,
        target_kind,
        target_id,
        role,
        assigned_by_account_id,
        created_at
      )
      VALUES ('space', 'space-1', 'user', '01J00000000000000000000002', 'read', '01J00000000000000000000001', 2);
    `);

    await updateSpaceVisibilityAfterCollaboratorChange(database, "space-1");

    await expect(getSpaceVisibility(database)).resolves.toBe("shared");
  });

  test("marks organization-wide collaborators as shared", async () => {
    const database = createSpaceVisibilityDatabase();

    database.execute(`
      INSERT INTO resource_acl (
        resource_type,
        resource_id,
        target_kind,
        target_id,
        role,
        assigned_by_account_id,
        created_at
      )
      VALUES ('space', 'space-1', 'organization', '01J00000000000000000000006', 'read', '01J00000000000000000000001', 2);
    `);

    await updateSpaceVisibilityAfterCollaboratorChange(database, "space-1");

    await expect(getSpaceVisibility(database)).resolves.toBe("shared");
  });
});
