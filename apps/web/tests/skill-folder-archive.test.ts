import { describe, expect, test } from "bun:test";

import { extractZipArchive } from "@mosoo/skill-package";

import { createSkillFolderArchiveFile } from "../src/domains/skill/lib/skill-folder-archive";
import type { SkillFolderFile } from "../src/domains/skill/lib/skill-folder-archive";

const SKILL_MARKDOWN = ["---", "name: demo-skill", "description: Demo skill", "---", "", "Body"]
  .join("\n")
  .concat("\n");

function folderFile(path: string, content: string): SkillFolderFile {
  const name = path.split("/").at(-1) ?? path;

  return { file: new File([content], name), path };
}

describe("createSkillFolderArchiveFile", () => {
  test("zips a folder into a skill archive with the wrapper stripped", async () => {
    const archive = await createSkillFolderArchiveFile({
      files: [
        folderFile("demo-skill/SKILL.md", SKILL_MARKDOWN),
        folderFile("demo-skill/scripts/run.md", "helper"),
      ],
      folderName: "demo-skill",
    });

    expect(archive.name).toBe("demo-skill.zip");
    expect(archive.type).toBe("application/zip");

    const entries = extractZipArchive(new Uint8Array(await archive.arrayBuffer()));
    const paths = entries.map((entry) => entry.path);

    expect(paths).toContain("SKILL.md");
    expect(paths).toContain("scripts/run.md");
  });

  test("drops junk files before packaging", async () => {
    const archive = await createSkillFolderArchiveFile({
      files: [
        folderFile("demo-skill/SKILL.md", SKILL_MARKDOWN),
        folderFile("demo-skill/.DS_Store", "junk"),
        folderFile("demo-skill/.git/config", "junk"),
        folderFile("demo-skill/node_modules/pkg/index.js", "junk"),
      ],
      folderName: "demo-skill",
    });

    const entries = extractZipArchive(new Uint8Array(await archive.arrayBuffer()));
    const paths = entries.map((entry) => entry.path);

    expect(paths).toEqual(["SKILL.md"]);
  });

  test("rejects a folder without a root SKILL.md", async () => {
    await expect(
      createSkillFolderArchiveFile({
        files: [folderFile("demo-skill/notes.md", "notes")],
        folderName: "demo-skill",
      }),
    ).rejects.toThrow("SKILL.md");
  });

  test("rejects a folder entry above the per-file limit", async () => {
    const oversized = new Uint8Array(2 * 1024 * 1024 + 1);

    await expect(
      createSkillFolderArchiveFile({
        files: [
          folderFile("demo-skill/SKILL.md", SKILL_MARKDOWN),
          { file: new File([oversized], "big.bin"), path: "demo-skill/big.bin" },
        ],
        folderName: "demo-skill",
      }),
    ).rejects.toThrow("File exceeds the 2 MB limit: demo-skill/big.bin");
  });
});
