import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DriverExecutionSpec, DriverResolvedSkill } from "@mosoo/driver-protocol";
import { createBufferedSinkLogger } from "@mosoo/observability";
import { createMarkdownSkillPackage, createZipArchive } from "@mosoo/skill-package";
import type { SkillPackageEntry } from "@mosoo/skill-package";

import { materializeResolvedSkills } from "../src/runtimes/skill-materialization";
import { bootPayload } from "./driver-runtime-boundary-fixtures";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function toDataUrl(bytes: Uint8Array): string {
  return `data:application/zip;base64,${Buffer.from(bytes).toString("base64")}`;
}

function createExecution(root: string, skill: DriverResolvedSkill): DriverExecutionSpec {
  return {
    ...bootPayload.execution,
    session: {
      ...bootPayload.execution.session,
      context: {
        ...bootPayload.execution.session.context,
        sessionOrganizationPath: root,
      },
      cwd: root,
    },
    skillCatalog: [],
    skills: [skill],
  };
}

function createSkill(root: string, archive: Uint8Array): DriverResolvedSkill {
  return {
    archiveFormat: "zip",
    blobSha256: sha256(archive),
    compression: "deflate",
    downloadUrl: toDataUrl(archive),
    materializationStatus: "pending",
    mountPath: join(root, ".mosoo", "skill", "review"),
    resolutionMode: "explicit",
    skillId: "skill-1",
    skillName: "review",
    snapshotId: "snapshot-1",
    warningCode: null,
  };
}

describe("skill materialization", () => {
  test("extracts a resolved skill under the session skill root", async () => {
    const root = await mkdtemp(join(tmpdir(), "mosoo-skill-materialization-"));
    const logger = createBufferedSinkLogger({
      level: "debug",
      service: "skill-materialization-test",
      sink: async () => {},
    });
    const archive = createZipArchive(
      createMarkdownSkillPackage(`---
name: review
description: Review code changes.
---

Check the diff.`).entries,
    );
    const skill = createSkill(root, archive);

    try {
      const [materialized] = await materializeResolvedSkills(createExecution(root, skill), logger);

      expect(materialized).toEqual({
        mountPath: skill.mountPath,
        skillId: "skill-1",
        skillMarkdownPath: join(skill.mountPath, "SKILL.md"),
        skillName: "review",
        snapshotId: "snapshot-1",
      });
      await expect(readFile(join(skill.mountPath, "SKILL.md"), "utf8")).resolves.toContain(
        "Check the diff.",
      );
    } finally {
      await logger.destroy();
      await rm(root, { force: true, recursive: true });
    }
  });

  test("rejects skill mounts outside the session skill root", async () => {
    const root = await mkdtemp(join(tmpdir(), "mosoo-skill-materialization-"));
    const logger = createBufferedSinkLogger({
      level: "debug",
      service: "skill-materialization-test",
      sink: async () => {},
    });
    const archive = createZipArchive(
      createMarkdownSkillPackage(`---
name: review
description: Review code changes.
---

Check the diff.`).entries,
    );
    const skill = {
      ...createSkill(root, archive),
      mountPath: join(root, "skill", "review"),
    };

    try {
      await expect(materializeResolvedSkills(createExecution(root, skill), logger)).rejects.toThrow(
        "outside the allowed root",
      );
    } finally {
      await logger.destroy();
      await rm(root, { force: true, recursive: true });
    }
  });

  test("fails malformed packages before reporting materialization success", async () => {
    const root = await mkdtemp(join(tmpdir(), "mosoo-skill-materialization-"));
    const logger = createBufferedSinkLogger({
      level: "debug",
      service: "skill-materialization-test",
      sink: async () => {},
    });
    const archive = createZipArchive([
      {
        body: new TextEncoder().encode("missing skill markdown"),
        entryKind: "file",
        isExecutable: false,
        path: "README.md",
      } satisfies SkillPackageEntry,
    ]);
    const skill = createSkill(root, archive);

    try {
      await expect(materializeResolvedSkills(createExecution(root, skill), logger)).rejects.toThrow(
        "does not contain SKILL.md",
      );
    } finally {
      await logger.destroy();
      await rm(root, { force: true, recursive: true });
    }
  });
});
