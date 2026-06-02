import { describe, expect, test } from "bun:test";

import {
  SkillPackageError,
  createZipArchive,
  extractZipArchive,
  normalizeSkillEntries,
  parseSkillMarkdown,
  toEntryRecord,
} from "@mosoo/skill-package";

const markdown = new TextEncoder().encode(
  "---\nname: Test\ndescription: Test skill.\n---\n# Test\n",
);
const data = new TextEncoder().encode("data");

describe("skill package path admission", () => {
  test("rejects duplicate normalized source entries before records are built", () => {
    expect(() =>
      normalizeSkillEntries({
        "SKILL.md": { body: markdown },
        "references/a.txt": { body: data },
        "references\\a.txt": { body: data },
      }),
    ).toThrow(SkillPackageError);
  });

  test("rejects file and child path collisions", () => {
    expect(() =>
      normalizeSkillEntries({
        "SKILL.md": { body: markdown },
        references: { body: data },
        "references/a.txt": { body: data },
      }),
    ).toThrow(SkillPackageError);
  });

  test("rejects unsafe paths before normalizing them", () => {
    expect(() =>
      normalizeSkillEntries({
        "/SKILL.md": { body: markdown },
      }),
    ).toThrow(SkillPackageError);

    expect(() =>
      normalizeSkillEntries({
        "refs/\u0000secret.txt": { body: data },
        "SKILL.md": { body: markdown },
      }),
    ).toThrow(SkillPackageError);

    expect(() =>
      normalizeSkillEntries({
        "../SKILL.md": { body: markdown },
      }),
    ).toThrow(SkillPackageError);

    expect(() =>
      normalizeSkillEntries({
        "references//a.txt": { body: data },
        "SKILL.md": { body: markdown },
      }),
    ).toThrow(SkillPackageError);

    expect(() =>
      normalizeSkillEntries({
        "references/./a.txt": { body: data },
        "SKILL.md": { body: markdown },
      }),
    ).toThrow(SkillPackageError);

    expect(() =>
      normalizeSkillEntries({
        "references/\ufffd.txt": { body: data },
        "SKILL.md": { body: markdown },
      }),
    ).toThrow(SkillPackageError);

    expect(() =>
      normalizeSkillEntries({
        "secrets/token.txt": { body: data },
        "SKILL.md": { body: markdown },
      }),
    ).toThrow(SkillPackageError);
  });

  test("admits only the manifest file and declared skill roots", () => {
    const normalized = normalizeSkillEntries({
      "SKILL.md": { body: markdown },
      "assets/logo.png": { body: data },
      "references/guide.md": { body: data },
      "scripts/run.sh": { body: data, isExecutable: true },
    });

    expect(normalized.skillMarkdownPath).toBe("SKILL.md");
    expect(normalized.entries.map((entry) => entry.path).toSorted()).toEqual(
      [
        "assets",
        "assets/logo.png",
        "references",
        "references/guide.md",
        "scripts",
        "scripts/run.sh",
        "SKILL.md",
      ].toSorted(),
    );

    expect(() =>
      normalizeSkillEntries({
        "SKILL.md": { body: markdown },
        "README.md": { body: data },
      }),
    ).toThrow(SkillPackageError);

    expect(() =>
      normalizeSkillEntries({
        "SKILL.md": { body: markdown },
        examples: { body: data, entryKind: "directory" },
      }),
    ).toThrow(SkillPackageError);

    expect(() =>
      normalizeSkillEntries({
        "SKILL.md": { body: markdown },
        scripts: { body: data },
      }),
    ).toThrow(SkillPackageError);
  });

  test("rejects invalid manifest entry shapes", () => {
    expect(() =>
      normalizeSkillEntries({
        "SKILL.md/": { body: data, entryKind: "directory" },
      }),
    ).toThrow(SkillPackageError);

    expect(() =>
      normalizeSkillEntries({
        "SKILL.md/child.md": { body: data },
      }),
    ).toThrow(SkillPackageError);
  });

  test("rejects traversal and unsupported roots in frontmatter paths", () => {
    expect(() =>
      parseSkillMarkdown(
        "---\nname: Test\ndescription: Test skill.\ndependencies:\n  - ../shared\n---\n",
      ),
    ).toThrow(SkillPackageError);

    expect(() =>
      parseSkillMarkdown(
        "---\nname: Test\ndescription: Test skill.\ndependencies:\n  - docs/guide.md\n---\n",
      ),
    ).toThrow(SkillPackageError);

    expect(
      parseSkillMarkdown(
        "---\nname: Test\ndescription: Test skill.\ndependencies:\n  - references/guide.md\n  - scripts/run.sh\n---\n",
      ).frontmatter.dependencies,
    ).toEqual(["references/guide.md", "scripts/run.sh"]);
  });

  test("rejects duplicate normalized zip entries", () => {
    const archive = createZipArchive([
      {
        body: data,
        entryKind: "file",
        isExecutable: false,
        path: "SKILL.md",
      },
    ]);

    expect(extractZipArchive(archive)[0]?.path).toBe("SKILL.md");

    expect(() =>
      createZipArchive([
        {
          body: data,
          entryKind: "file",
          isExecutable: false,
          path: "references/a.txt",
        },
        {
          body: data,
          entryKind: "file",
          isExecutable: false,
          path: "references\\a.txt",
        },
      ]),
    ).toThrow(SkillPackageError);
  });

  test("rejects unsupported zip roots before building an entry record", () => {
    const archive = createZipArchive([
      {
        body: markdown,
        entryKind: "file",
        isExecutable: false,
        path: "SKILL.md",
      },
      {
        body: data,
        entryKind: "file",
        isExecutable: false,
        path: "notes.txt",
      },
    ]);

    expect(() => toEntryRecord(extractZipArchive(archive))).toThrow(SkillPackageError);
  });
});
