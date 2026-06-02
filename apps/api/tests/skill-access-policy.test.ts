import { describe, expect, test } from "bun:test";

import {
  ensureSkillAccess,
  ensureSkillDestructiveManager,
  ensureSkillEditor,
} from "../src/modules/skills/application/skill-access.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

function createSkillAccessDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      name text
    );

    CREATE TABLE skill (
      id text PRIMARY KEY NOT NULL,
      author text NOT NULL,
      current_snapshot_id text NOT NULL,
      description text NOT NULL,
      forked_from_owner_name text,
      forked_from_skill_id text,
      forked_from_skill_name text,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      source_kind text NOT NULL,
      updated_at integer NOT NULL,
      created_at integer NOT NULL,
      version text
    );

    CREATE TABLE skill_preference (
      skill_id text NOT NULL,
      account_id text NOT NULL,
      auto_enabled integer NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      PRIMARY KEY (skill_id, account_id)
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

    INSERT INTO account (id, name)
    VALUES
      ('01J00000000000000000000001', 'Owner One'),
      ('owner-2', 'Owner Two'),
      ('viewer-1', 'Viewer One'),
      ('admin-1', 'Admin One');

    INSERT INTO skill (
      id,
      author,
      current_snapshot_id,
      description,
      name,
      organization_id,
      owner_account_id,
      source_kind,
      updated_at,
      created_at,
      version
    )
    VALUES
      ('skill-1', 'Owner One', 'snapshot-1', 'Shared skill', 'Shared', '01J00000000000000000000006', '01J00000000000000000000001', 'user', 3, 1, NULL),
      ('skill-2', 'Owner Two', 'snapshot-2', 'Disabled owner skill', 'Dormant', '01J00000000000000000000006', 'owner-2', 'user', 4, 2, NULL);

    INSERT INTO organization_member (
      organization_id,
      account_id,
      role,
      disabled_at
    )
    VALUES
      ('01J00000000000000000000006', '01J00000000000000000000001', 'member', NULL),
      ('01J00000000000000000000006', 'owner-2', 'member', 20),
      ('01J00000000000000000000006', 'viewer-1', 'member', NULL),
      ('01J00000000000000000000006', 'admin-1', 'admin', NULL);

    INSERT INTO resource_acl (
      resource_type,
      resource_id,
      target_kind,
      target_id,
      role,
      assigned_by_account_id,
      created_at
    )
    VALUES ('skill', 'skill-1', 'user', 'viewer-1', 'user', '01J00000000000000000000001', 2);
  `);

  return database;
}

describe("skill access policy", () => {
  test("resolves shared skill access", async () => {
    const database = createSkillAccessDatabase();

    const row = await ensureSkillAccess(database, "viewer-1", "skill-1");

    expect(row.id).toBe("skill-1");
    expect(row.ownerId).toBe("01J00000000000000000000001");
  });

  test("resolves organization editor passthrough", async () => {
    const database = createSkillAccessDatabase();

    const row = await ensureSkillEditor(database, "admin-1", "skill-1");

    expect(row.id).toBe("skill-1");
  });

  test("denies active-owner destructive management", async () => {
    const database = createSkillAccessDatabase();

    await expect(ensureSkillDestructiveManager(database, "admin-1", "skill-1")).rejects.toThrow(
      "You do not have permission to perform this action.",
    );
  });

  test("resolves disabled-owner destructive management", async () => {
    const database = createSkillAccessDatabase();

    const row = await ensureSkillDestructiveManager(database, "admin-1", "skill-2");

    expect(row.id).toBe("skill-2");
  });
});
