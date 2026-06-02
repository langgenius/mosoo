import { describe, expect, test } from "bun:test";

import {
  ensureSpaceAccess,
  listSpaceAccessRows,
} from "../src/modules/spaces/domain/space-access.policy";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createSpaceAccessDatabase(): SqliteD1Database {
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

    CREATE TABLE organization_member (
      organization_id text NOT NULL,
      account_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      PRIMARY KEY (organization_id, account_id)
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
    VALUES
      ('space-1', 'Docs', '01J00000000000000000000006', '01J00000000000000000000001', 'shared', 1, 1),
      ('space-2', 'Archive', 'org-2', 'owner-2', 'shared', 1, 1);

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at
    )
    VALUES
      ('01J00000000000000000000006', '01J00000000000000000000001', 'member', NULL),
      ('01J00000000000000000000006', 'viewer-1', 'member', NULL),
      ('01J00000000000000000000006', 'admin-1', 'admin', NULL),
      ('org-2', 'viewer-1', 'member', 10);

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
      ('space', 'space-1', 'user', '01J00000000000000000000001', 'admin', '01J00000000000000000000001', 1),
      ('space', 'space-1', 'user', 'viewer-1', 'read', '01J00000000000000000000001', 2),
      ('space', 'space-2', 'user', 'viewer-1', 'read', 'owner-2', 2);
  `);

  return database;
}

describe("space access policy", () => {
  test("resolves direct space access", async () => {
    const database = createSpaceAccessDatabase();

    const row = await ensureSpaceAccess(database, "viewer-1", "space-1", "read");

    expect(row.creator_membership_status).toBe("active");
    expect(row.role_rank).toBe(1);
    expect(row.viewer_organization_role).toBe("member");
  });

  test("resolves organization admin passthrough", async () => {
    const database = createSpaceAccessDatabase();

    const row = await ensureSpaceAccess(database, "admin-1", "space-1", "edit");

    expect(row.role_rank).toBe(3);
    expect(row.viewer_organization_role).toBe("admin");
  });

  test("batch access lookup reads spaces and active memberships together", async () => {
    const database = createSpaceAccessDatabase();

    const access = await listSpaceAccessRows(database, "viewer-1", [
      "space-1",
      "space-2",
      "space-missing",
      "space-1",
    ]);

    expect([...access.existingSpaceIds].toSorted()).toEqual(["space-1", "space-2"]);
    expect([...access.accessibleRowsById.keys()]).toEqual(["space-1"]);
  });
});
