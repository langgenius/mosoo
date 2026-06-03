import { describe, expect, test } from "bun:test";

import type { AccountId, OrganizationId, SpaceId } from "@mosoo/id";

import type { AuthenticatedViewer } from "../src/modules/auth/application/viewer-auth.service";
import { updateSpace } from "../src/modules/spaces/application/space.service";
import { updateSpaceVisibilityAfterCollaboratorChange } from "../src/modules/spaces/domain/space-visibility.policy";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_ID = "01J00000000000000000000001" as AccountId;
const COLLABORATOR_ID = "01J00000000000000000000002" as AccountId;
const ORGANIZATION_ID = "01J00000000000000000000006" as OrganizationId;
const SPACE_ID = "01J0000000000000000000000A" as SpaceId;
const OWNER_VIEWER = {
  email: "owner@example.com",
  emailVerified: true,
  id: OWNER_ID,
  imageUrl: null,
  name: "Owner",
} satisfies AuthenticatedViewer;

function createSpaceVisibilityDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE organization_member (
      account_id text NOT NULL,
      organization_id text NOT NULL,
      role text NOT NULL,
      disabled_at integer,
      PRIMARY KEY (organization_id, account_id)
    );

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
    VALUES ('${SPACE_ID}', 'Docs', '${ORGANIZATION_ID}', '${OWNER_ID}', 'shared', 1, 1);

    INSERT INTO organization_member (
      account_id,
      organization_id,
      role,
      disabled_at
    )
    VALUES ('${OWNER_ID}', '${ORGANIZATION_ID}', 'member', NULL);

    INSERT INTO resource_acl (
      resource_type,
      resource_id,
      target_kind,
      target_id,
      role,
      assigned_by_account_id,
      created_at
    )
    VALUES ('space', '${SPACE_ID}', 'user', '${OWNER_ID}', 'admin', '${OWNER_ID}', 1);
  `);

  return database;
}

async function getSpaceVisibility(database: SqliteD1Database): Promise<string | null> {
  const row = await database
    .prepare(`SELECT visibility FROM space WHERE id = '${SPACE_ID}'`)
    .first<{ visibility: string }>();

  return row?.visibility ?? null;
}

async function listSpaceAclRows(database: SqliteD1Database): Promise<
  Array<{
    role: string;
    target_id: string;
    target_kind: string;
  }>
> {
  const result = await database
    .prepare(
      `SELECT target_kind, target_id, role
       FROM resource_acl
       WHERE resource_type = 'space' AND resource_id = '${SPACE_ID}'
       ORDER BY target_kind, target_id`,
    )
    .all<{
      role: string;
      target_id: string;
      target_kind: string;
    }>();

  return result.results;
}

describe("space visibility policy", () => {
  test("marks owner-only ACL as private", async () => {
    const database = createSpaceVisibilityDatabase();

    await updateSpaceVisibilityAfterCollaboratorChange(database, SPACE_ID);

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
      VALUES ('space', '${SPACE_ID}', 'user', '${COLLABORATOR_ID}', 'read', '${OWNER_ID}', 2);
    `);

    await updateSpaceVisibilityAfterCollaboratorChange(database, SPACE_ID);

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
      VALUES ('space', '${SPACE_ID}', 'organization', '${ORGANIZATION_ID}', 'read', '${OWNER_ID}', 2);
    `);

    await updateSpaceVisibilityAfterCollaboratorChange(database, SPACE_ID);

    await expect(getSpaceVisibility(database)).resolves.toBe("shared");
  });

  test("private space updates remove non-owner ACLs and derive visibility", async () => {
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
      VALUES
        ('space', '${SPACE_ID}', 'user', '${COLLABORATOR_ID}', 'read', '${OWNER_ID}', 2),
        ('space', '${SPACE_ID}', 'organization', '${ORGANIZATION_ID}', 'read', '${OWNER_ID}', 3);
    `);

    await updateSpace(database, OWNER_VIEWER, {
      spaceId: SPACE_ID,
      visibility: "private",
    });

    await expect(getSpaceVisibility(database)).resolves.toBe("private");
    await expect(listSpaceAclRows(database)).resolves.toEqual([
      {
        role: "admin",
        target_id: OWNER_ID,
        target_kind: "user",
      },
    ]);
  });
});
