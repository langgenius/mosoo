import { describe, expect, test } from "bun:test";

import {
  ensureSkillAccess,
  ensureSkillDestructiveManager,
  ensureSkillEditor,
  listAppSkillRows,
} from "../src/modules/skills/application/skill-access.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

const IDS = {
  owner: "01J00000000000000000000001",
  app: "01J00000000000000000000002",
  otherApp: "01J00000000000000000000003",
  organization: "01J00000000000000000000006",
  otherOwner: "01J00000000000000000000007",
  skill: "01J00000000000000000000008",
  otherAppSkill: "01J00000000000000000000009",
} as const;

function createSkillAccessDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
    CREATE TABLE account (
      id text PRIMARY KEY NOT NULL,
      name text
    );

    CREATE TABLE app (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      default_environment_id text,
      name text NOT NULL,
      organization_id text NOT NULL,
      owner_account_id text NOT NULL,
      slug text NOT NULL,
      updated_at integer NOT NULL
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
      owner_account_id text NOT NULL,
      app_id text NOT NULL,
      source_kind text NOT NULL,
      updated_at integer NOT NULL,
      created_at integer NOT NULL,
      version text
    );

    INSERT INTO account (id, name)
    VALUES
      ('${IDS.owner}', 'Owner One'),
      ('${IDS.otherOwner}', 'Other Owner');

    INSERT INTO app (
      id,
      created_at,
      default_environment_id,
      name,
      organization_id,
      owner_account_id,
      slug,
      updated_at
    )
    VALUES
      ('${IDS.app}', 1, NULL, 'Main App', '${IDS.organization}', '${IDS.owner}', 'main', 1),
      ('${IDS.otherApp}', 1, NULL, 'Other App', '${IDS.organization}', '${IDS.owner}', 'other', 1);

    INSERT INTO skill (
      id,
      author,
      current_snapshot_id,
      description,
      name,
      owner_account_id,
      app_id,
      source_kind,
      updated_at,
      created_at,
      version
    )
    VALUES
      ('${IDS.skill}', 'Owner One', 'snapshot-1', 'App skill', 'Main Skill', '${IDS.owner}', '${IDS.app}', 'user', 3, 1, NULL),
      ('${IDS.otherAppSkill}', 'Owner One', 'snapshot-2', 'Other App skill', 'Other Skill', '${IDS.owner}', '${IDS.otherApp}', 'user', 4, 2, NULL);
  `);

  return database;
}

describe("skill access policy", () => {
  test("allows app owner to read and edit an App Skill", async () => {
    const database = createSkillAccessDatabase();

    const readable = await ensureSkillAccess(database, IDS.owner, IDS.app, IDS.skill);
    const editable = await ensureSkillEditor(database, IDS.owner, IDS.app, IDS.skill);
    const destructive = await ensureSkillDestructiveManager(
      database,
      IDS.owner,
      IDS.app,
      IDS.skill,
    );

    expect(readable.id).toBe(IDS.skill);
    expect(editable.id).toBe(IDS.skill);
    expect(destructive.id).toBe(IDS.skill);
  });

  test("fails closed when the Skill belongs to another App", async () => {
    const database = createSkillAccessDatabase();

    await expect(ensureSkillAccess(database, IDS.owner, IDS.otherApp, IDS.skill)).rejects.toThrow(
      "Skill not found.",
    );
  });

  test("denies users who do not own the App", async () => {
    const database = createSkillAccessDatabase();

    await expect(ensureSkillAccess(database, IDS.otherOwner, IDS.app, IDS.skill)).rejects.toThrow(
      "You do not have permission to perform this action.",
    );
  });

  test("lists only skills in the requested App", async () => {
    const database = createSkillAccessDatabase();

    const rows = await listAppSkillRows(database, IDS.owner, IDS.app);

    expect(rows.map((row) => row.id)).toEqual([IDS.skill]);
  });
});
