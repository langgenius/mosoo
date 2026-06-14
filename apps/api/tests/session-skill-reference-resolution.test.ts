import { describe, expect, test } from "bun:test";

import type { SessionExecutionPlan } from "../src/modules/runtime/application/session-definition/session-execution.types";
import { resolveSessionSkillReferences } from "../src/modules/runtime/application/session-definition/session-skill-reference-resolution.service";
import { SqliteD1Database } from "./helpers/sqlite-d1";

type SessionSkillReference = SessionExecutionPlan["skills"][number];

const IDS = {
  app: "01J00000000000000000000002",
  otherApp: "01J00000000000000000000003",
  organization: "01J00000000000000000000006",
} as const;

function createSessionSkillReferenceDatabase(): SqliteD1Database {
  const database = new SqliteD1Database({ foreignKeys: false });

  database.execute(`
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
      app_id text NOT NULL,
      skill_markdown_path text NOT NULL,
      uncompressed_size integer NOT NULL,
      version text
    );

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
      app_id,
      skill_markdown_path,
      uncompressed_size,
      version
    )
    VALUES
      ('Owner One', 'blob-owned', 'sha-owned', 100, 1, 'Owned', 'snapshot-owned', 'Owned Skill', '${IDS.organization}', '${IDS.app}', 'SKILL.md', 200, '1.0.0'),
      ('Owner One', 'blob-explicit', 'sha-explicit', 110, 1, 'Explicit', 'snapshot-explicit', 'Explicit Skill', '${IDS.organization}', '${IDS.app}', 'SKILL.md', 210, '1.1.0'),
      ('Package', 'blob-package', 'sha-package', 120, 1, 'Package', 'snapshot-package', 'Package Skill', '${IDS.organization}', '${IDS.app}', 'SKILL.md', 220, '2.0.0'),
      ('Package', 'blob-other-app', 'sha-other-app', 130, 1, 'Other', 'snapshot-other-app', 'Other Skill', '${IDS.organization}', '${IDS.otherApp}', 'SKILL.md', 230, NULL);
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
  test("resolves frozen skill snapshots in the session App", async () => {
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
        skillId: "skill-explicit",
        skillName: "Explicit Skill",
        snapshotId: "snapshot-explicit",
        sortOrder: 1,
      }),
      createSkillReference({
        skillId: "skill-missing",
        skillName: "Missing Skill",
        snapshotId: null,
        resolutionMode: "tombstone",
        sortOrder: 2,
      }),
      createSkillReference({
        skillId: "package:docs",
        skillName: "Package Skill",
        snapshotId: "snapshot-package",
        sortOrder: 3,
      }),
    ];

    const resolved = await resolveSessionSkillReferences({
      database,
      sessionAppId: IDS.app,
      skillMountRoot,
      skillReferences: references,
    });

    expect(resolved.map((entry) => entry.skill.skillId)).toEqual([
      "skill-owned",
      "skill-explicit",
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
      blobSha256: "sha-explicit",
      materializationStatus: "pending",
      mountPath: `${skillMountRoot}/skill-explicit`,
      snapshotId: "snapshot-explicit",
    });
    expect(resolved[2]?.warnings[0]?.message).toBe("Missing Skill is unavailable and was skipped.");
    expect(resolved[3]?.skill).toMatchObject({
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
        sessionAppId: IDS.app,
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

  test("rejects explicit snapshots from another App", async () => {
    await expect(
      resolveSessionSkillReferences({
        database: createSessionSkillReferenceDatabase(),
        sessionAppId: IDS.app,
        skillMountRoot: "skill-root",
        skillReferences: [
          createSkillReference({
            skillId: "skill-other",
            skillName: "Other App Skill",
            snapshotId: "snapshot-other-app",
            sortOrder: 0,
          }),
        ],
      }),
    ).rejects.toThrow("Skill snapshot belongs to another App.");
  });

  test("rejects package snapshots from another App", async () => {
    await expect(
      resolveSessionSkillReferences({
        database: createSessionSkillReferenceDatabase(),
        sessionAppId: IDS.app,
        skillMountRoot: "skill-root",
        skillReferences: [
          createSkillReference({
            skillId: "package:other",
            skillName: "Other Package",
            snapshotId: "snapshot-other-app",
            sortOrder: 0,
          }),
        ],
      }),
    ).rejects.toThrow("Package-owned skill snapshot belongs to another App.");
  });
});
