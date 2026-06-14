import { describe, expect, test } from "bun:test";

import type { AccountId, AppId, SpaceId } from "@mosoo/id";

import {
  ensureSpaceAccess,
  ensureSpaceAccessBySpaceId,
  listSpaceAccessRows,
} from "../src/modules/spaces/domain/space-access.policy";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const OWNER_ID = "01J00000000000000000000001" as AccountId;
const OTHER_OWNER_ID = "01J00000000000000000000002" as AccountId;
const APP_ID = "01J00000000000000000000003" as AppId;
const OTHER_APP_ID = "01J00000000000000000000004" as AppId;
const SPACE_ID = "01J00000000000000000000005" as SpaceId;
const OTHER_SPACE_ID = "01J00000000000000000000006" as SpaceId;
const MISSING_SPACE_ID = "01J00000000000000000000007" as SpaceId;

function createSpaceAccessDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
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

    CREATE TABLE space (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      app_id text NOT NULL,
      owner_account_id text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );

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
      ('${APP_ID}', '01J00000000000000000000008', '${OWNER_ID}', 'Main App', 'main', NULL, 1, 1),
      (
        '${OTHER_APP_ID}',
        '01J00000000000000000000008',
        '${OTHER_OWNER_ID}',
        'Other App',
        'other',
        NULL,
        1,
        1
      );

    INSERT INTO space (
      id,
      name,
      app_id,
      owner_account_id,
      created_at,
      updated_at
    )
    VALUES
      ('${SPACE_ID}', 'Docs', '${APP_ID}', '${OWNER_ID}', 1, 1),
      ('${OTHER_SPACE_ID}', 'Archive', '${OTHER_APP_ID}', '${OTHER_OWNER_ID}', 1, 1);
  `);

  return database;
}

describe("space access policy", () => {
  test("resolves owner access through App proof", async () => {
    const database = createSpaceAccessDatabase();

    const row = await ensureSpaceAccess(database, OWNER_ID, APP_ID, SPACE_ID, "read");

    expect(row).toMatchObject({
      id: SPACE_ID,
      owner_account_id: OWNER_ID,
      app_id: APP_ID,
      role_rank: 3,
    });
  });

  test("fails closed when the viewer does not own the App", async () => {
    const database = createSpaceAccessDatabase();

    await expect(
      ensureSpaceAccess(database, OTHER_OWNER_ID, APP_ID, SPACE_ID, "read"),
    ).rejects.toThrow("Space not found.");
  });

  test("batch lookup only returns spaces inside the requested App", async () => {
    const database = createSpaceAccessDatabase();

    const access = await listSpaceAccessRows(database, OWNER_ID, APP_ID, [
      SPACE_ID,
      OTHER_SPACE_ID,
      MISSING_SPACE_ID,
      SPACE_ID,
    ]);

    expect([...access.existingSpaceIds]).toEqual([SPACE_ID]);
    expect([...access.accessibleRowsById.keys()]).toEqual([SPACE_ID]);
  });

  test("space-id lookup resolves the owning App for file-scoped flows", async () => {
    const database = createSpaceAccessDatabase();

    const row = await ensureSpaceAccessBySpaceId(database, OWNER_ID, SPACE_ID, "edit");

    expect(row.app_id).toBe(APP_ID);
    expect(row.role_rank).toBe(3);
  });

  test("space-id lookup rejects non-owner viewers", async () => {
    const database = createSpaceAccessDatabase();

    await expect(
      ensureSpaceAccessBySpaceId(database, OTHER_OWNER_ID, SPACE_ID, "read"),
    ).rejects.toThrow("Space not found.");
  });
});
