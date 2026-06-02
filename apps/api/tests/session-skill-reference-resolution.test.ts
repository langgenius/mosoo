import { describe, expect, test } from "bun:test";

import type { SessionExecutionPlan } from "../src/modules/runtime/application/session-definition/session-execution.types";
import { resolveSessionSkillReferences } from "../src/modules/runtime/application/session-definition/session-skill-reference-resolution.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

type SessionSkillReference = SessionExecutionPlan["skills"][number];

function createSessionSkillReferenceDatabase(): SqliteD1Database {
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

    CREATE TABLE skill_snapshot (
      author text NOT NULL,
      blob_key text NOT NULL,
      blob_sha256 text NOT NULL,
      blob_size integer NOT NULL,
      created_at integer NOT NULL,
      description text NOT NULL,
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      organization_id text NOT NULL,
      skill_markdown_path text NOT NULL,
      uncompressed_size integer NOT NULL,
      version text
    );

    INSERT INTO account (id, name)
    VALUES
      ('01J00000000000000000000001', 'Owner One'),
      ('owner-2', 'Owner Two');

    INSERT INTO organization_member (organization_id, account_id, role, disabled_at)
    VALUES
      ('01J00000000000000000000006', '01J00000000000000000000001', 'member', NULL),
      ('01J00000000000000000000006', 'owner-2', 'member', NULL);

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
      ('skill-owned', 'Owner One', 'snapshot-owned', 'Owned', 'Owned Skill', '01J00000000000000000000006', '01J00000000000000000000001', 'user', 2, 1, NULL),
      ('skill-shared', 'Owner Two', 'snapshot-shared', 'Shared', 'Shared Skill', '01J00000000000000000000006', 'owner-2', 'user', 3, 1, NULL),
      ('skill-denied', 'Owner Two', 'snapshot-denied', 'Denied', 'Denied Skill', '01J00000000000000000000006', 'owner-2', 'user', 4, 1, NULL);

    INSERT INTO resource_acl (
      resource_type,
      resource_id,
      target_kind,
      target_id,
      role,
      assigned_by_account_id,
      created_at
    )
    VALUES ('skill', 'skill-shared', 'user', '01J00000000000000000000001', 'user', 'owner-2', 2);

    INSERT INTO skill_snapshot (
      author,
      blob_key,
      blob_sha256,
      blob_size,
      created_at,
      description,
      id,
      name,
      organization_id,
      skill_markdown_path,
      uncompressed_size,
      version
    )
    VALUES
      ('Owner One', 'blob-owned', 'sha-owned', 100, 1, 'Owned', 'snapshot-owned', 'Owned Skill', '01J00000000000000000000006', 'SKILL.md', 200, '1.0.0'),
      ('Owner Two', 'blob-shared', 'sha-shared', 110, 1, 'Shared', 'snapshot-shared', 'Shared Skill', '01J00000000000000000000006', 'SKILL.md', 210, '1.1.0'),
      ('Owner Two', 'blob-denied', 'sha-denied', 115, 1, 'Denied', 'snapshot-denied', 'Denied Skill', '01J00000000000000000000006', 'SKILL.md', 215, '1.2.0'),
      ('Package', 'blob-package', 'sha-package', 120, 1, 'Package', 'snapshot-package', 'Package Skill', '01J00000000000000000000006', 'SKILL.md', 220, '2.0.0'),
      ('Package', 'blob-other-org', 'sha-other-org', 130, 1, 'Other', 'snapshot-other-org', 'Other Skill', 'org-2', 'SKILL.md', 230, NULL);
  `);

  return database;
}

function createSkillReference(input: {
  skillId: string;
  skillName: string;
  snapshotId: string | null;
  sortOrder: number;
  resolutionMode?: SessionSkillReference["resolutionMode"];
}): SessionSkillReference {
  return {
    resolutionMode: input.resolutionMode ?? "explicit",
    skillId: input.skillId,
    skillName: input.skillName,
    snapshotId: input.snapshotId,
    sortOrder: input.sortOrder,
  };
}

describe("session skill reference resolution", () => {
  test("resolves frozen skill snapshots", async () => {
    const database = createSessionSkillReferenceDatabase();
    const skillMountRoot = "skill-root";

    const references = [
      createSkillReference({
        skillId: "skill-owned",
        skillName: "Owned Skill",
        snapshotId: "snapshot-owned",
        sortOrder: 0,
      }),
      createSkillReference({
        skillId: "skill-shared",
        skillName: "Shared Skill",
        snapshotId: "snapshot-shared",
        sortOrder: 1,
      }),
      createSkillReference({
        skillId: "skill-denied",
        skillName: "Denied Skill",
        snapshotId: "snapshot-denied",
        sortOrder: 2,
      }),
      createSkillReference({
        skillId: "skill-missing",
        skillName: "Missing Skill",
        snapshotId: null,
        resolutionMode: "tombstone",
        sortOrder: 3,
      }),
      createSkillReference({
        skillId: "package:docs",
        skillName: "Package Skill",
        snapshotId: "snapshot-package",
        sortOrder: 4,
      }),
    ];

    const resolved = await resolveSessionSkillReferences({
      database,
      sessionOrganizationId: "01J00000000000000000000006",
      skillMountRoot,
      skillReferences: references,
    });

    expect(resolved.map((entry) => entry.skill.skillId)).toEqual([
      "skill-owned",
      "skill-shared",
      "skill-denied",
      "skill-missing",
      "package:docs",
    ]);
    expect(resolved[0]?.skill).toMatchObject({
      blobSha256: "sha-owned",
      materializationStatus: "pending",
      mountPath: `${skillMountRoot}/skill-owned`,
      snapshotId: "snapshot-owned",
    });
    expect(resolved[1]?.skill).toMatchObject({
      blobSha256: "sha-shared",
      materializationStatus: "pending",
      mountPath: `${skillMountRoot}/skill-shared`,
      snapshotId: "snapshot-shared",
    });
    expect(resolved[2]?.skill).toMatchObject({
      blobSha256: "sha-denied",
      materializationStatus: "pending",
      mountPath: `${skillMountRoot}/skill-denied`,
      resolutionMode: "explicit",
      snapshotId: "snapshot-denied",
    });
    expect(resolved[2]?.warnings).toEqual([]);
    expect(resolved[3]?.warnings[0]?.message).toBe("Missing Skill is unavailable and was skipped.");
    expect(resolved[4]?.skill).toMatchObject({
      blobSha256: "sha-package",
      materializationStatus: "pending",
      mountPath: `${skillMountRoot}/package:docs`,
      snapshotId: "snapshot-package",
    });
  });

  test("keeps missing non-package snapshots as hard failures", async () => {
    const database = createSessionSkillReferenceDatabase();

    await expect(
      resolveSessionSkillReferences({
        database,
        sessionOrganizationId: "01J00000000000000000000006",
        skillMountRoot: "skill-root",
        skillReferences: [
          createSkillReference({
            skillId: "skill-owned",
            skillName: "Owned Skill",
            snapshotId: "snapshot-missing",
            sortOrder: 0,
          }),
        ],
      }),
    ).rejects.toThrow("Skill snapshot not found.");
  });

  test("rejects package snapshots from another organization", async () => {
    await expect(
      resolveSessionSkillReferences({
        database: createSessionSkillReferenceDatabase(),
        sessionOrganizationId: "01J00000000000000000000006",
        skillMountRoot: "skill-root",
        skillReferences: [
          createSkillReference({
            skillId: "package:other",
            skillName: "Other Package",
            snapshotId: "snapshot-other-org",
            sortOrder: 0,
          }),
        ],
      }),
    ).rejects.toThrow("Package-owned skill snapshot belongs to another Organization.");
  });
});
