import { describe, expect, test } from "bun:test";

import type { SkillPackageEntry } from "@mosoo/skill-package";
import {
  SkillPackageError,
  createZipArchive,
  extractZipArchive,
  normalizeSkillEntries,
  parseSkillMarkdown,
  toEntryRecord,
} from "@mosoo/skill-package";
import { zipSync } from "fflate";

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

  test("admits the manifest file and arbitrary supporting roots", () => {
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

    expect(
      normalizeSkillEntries({
        "SKILL.md": { body: markdown },
        "README.md": { body: data },
        examples: { body: data, entryKind: "directory" },
      }).entries.map((entry) => entry.path),
    ).toContain("README.md");
  });

  test("admits anthropics-style skills with custom support directories", () => {
    const normalized = normalizeSkillEntries({
      "SKILL.md": { body: markdown },
      "LICENSE.txt": { body: data },
      "canvas-fonts/WorkSans-Regular.ttf": { body: data },
      "canvas-fonts/WorkSans-OFL.txt": { body: data },
    });

    expect(normalized.entries.map((entry) => entry.path).toSorted()).toEqual(
      [
        "canvas-fonts",
        "canvas-fonts/WorkSans-OFL.txt",
        "canvas-fonts/WorkSans-Regular.ttf",
        "LICENSE.txt",
        "SKILL.md",
      ].toSorted(),
    );
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

  test("rejects traversal in frontmatter paths but allows custom roots", () => {
    expect(() =>
      parseSkillMarkdown(
        "---\nname: Test\ndescription: Test skill.\ndependencies:\n  - ../shared\n---\n",
      ),
    ).toThrow(SkillPackageError);

    expect(
      parseSkillMarkdown(
        "---\nname: Test\ndescription: Test skill.\ndependencies:\n  - docs/guide.md\n---\n",
      ).frontmatter.dependencies,
    ).toEqual(["docs/guide.md"]);

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

  test("normalizes single wrapper zip archives to root-flat entries", () => {
    const normalized = normalizeZipEntries([
      {
        body: markdown,
        entryKind: "file",
        isExecutable: false,
        path: "mosoo/SKILL.md",
      },
      {
        body: data,
        entryKind: "file",
        isExecutable: false,
        path: "mosoo/references/guide.md",
      },
    ]);

    expect(normalized.skillMarkdownPath).toBe("SKILL.md");
    expect(normalized.entries.map((entry) => entry.path).toSorted()).toEqual(
      ["references", "references/guide.md", "SKILL.md"].toSorted(),
    );
  });

  test("keeps root-flat zip archives root-flat", () => {
    const normalized = normalizeZipEntries([
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
        path: "references/guide.md",
      },
    ]);

    expect(normalized.skillMarkdownPath).toBe("SKILL.md");
    expect(normalized.entries.map((entry) => entry.path).toSorted()).toEqual(
      ["references", "references/guide.md", "SKILL.md"].toSorted(),
    );
  });

  test("ignores macOS zip metadata before path admission", () => {
    const archive = zipSync({
      "._dify-brand-skills": data,
      "__MACOSX/._dify-brand-skills": data,
      "dify-brand-skills/.DS_Store": data,
      "dify-brand-skills/._SKILL.md": data,
      "dify-brand-skills/SKILL.md": markdown,
      "dify-brand-skills/references/.DS_Store": data,
      "dify-brand-skills/references/guide.md": data,
    });
    const normalized = normalizeSkillEntries(toEntryRecord(extractZipArchive(archive)));

    expect(normalized.skillMarkdownPath).toBe("SKILL.md");
    expect(normalized.entries.map((entry) => entry.path).toSorted()).toEqual(
      ["references", "references/guide.md", "SKILL.md"].toSorted(),
    );
  });

  test("matches UTF-8 zip filenames when the archive UTF-8 flag is missing", () => {
    const archive = clearZipUtf8Flags(
      zipSync({
        "dify-brand-skills/SKILL.md": markdown,
        "dify-brand-skills/assets/Söhne.otf": data,
      }),
    );
    const normalized = normalizeSkillEntries(toEntryRecord(extractZipArchive(archive)));

    expect(normalized.entries.map((entry) => entry.path).toSorted()).toEqual(
      ["assets", "assets/Söhne.otf", "SKILL.md"].toSorted(),
    );
  });

  test("admits custom roots after stripping single wrapper zip archives", () => {
    const normalized = normalizeZipEntries([
      {
        body: markdown,
        entryKind: "file",
        isExecutable: false,
        path: "mosoo/SKILL.md",
      },
      {
        body: data,
        entryKind: "file",
        isExecutable: false,
        path: "mosoo/examples/a.md",
      },
    ]);

    expect(normalized.entries.map((entry) => entry.path).toSorted()).toEqual(
      ["examples", "examples/a.md", "SKILL.md"].toSorted(),
    );
  });

  test("rejects zip archives with multiple wrappers or wrapper-external files", () => {
    expect(() =>
      normalizeZipEntries([
        {
          body: markdown,
          entryKind: "file",
          isExecutable: false,
          path: "mosoo/SKILL.md",
        },
        {
          body: data,
          entryKind: "file",
          isExecutable: false,
          path: "other/references/guide.md",
        },
      ]),
    ).toThrow(SkillPackageError);

    expect(() =>
      normalizeZipEntries([
        {
          body: markdown,
          entryKind: "file",
          isExecutable: false,
          path: "mosoo/SKILL.md",
        },
        {
          body: data,
          entryKind: "file",
          isExecutable: false,
          path: "README.md",
        },
      ]),
    ).toThrow(SkillPackageError);
  });

  test("admits root-level support files when normalizing entry records", () => {
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
    const record = toEntryRecord(extractZipArchive(archive));

    expect(record["notes.txt"]).toBeDefined();
    expect(
      normalizeSkillEntries(record)
        .entries.map((entry) => entry.path)
        .toSorted(),
    ).toEqual(["notes.txt", "SKILL.md"].toSorted());
  });
});

function normalizeZipEntries(entries: SkillPackageEntry[]) {
  const archive = createZipArchive(entries);

  return normalizeSkillEntries(toEntryRecord(extractZipArchive(archive)));
}

function clearZipUtf8Flags(archive: Uint8Array): Uint8Array {
  const patched = new Uint8Array(archive);
  let offset = 0;

  while (offset + 4 <= patched.byteLength) {
    const signature = readUint32LE(patched, offset);

    if (signature === 0x04_03_4b_50) {
      patched[offset + 7] = (patched[offset + 7] ?? 0) & ~0x08;
      const compressedSize = readUint32LE(patched, offset + 18);
      const fileNameLength = readUint16LE(patched, offset + 26);
      const extraLength = readUint16LE(patched, offset + 28);
      offset += 30 + fileNameLength + extraLength + compressedSize;
      continue;
    }

    if (signature === 0x02_01_4b_50) {
      patched[offset + 9] = (patched[offset + 9] ?? 0) & ~0x08;
      const fileNameLength = readUint16LE(patched, offset + 28);
      const extraLength = readUint16LE(patched, offset + 30);
      const commentLength = readUint16LE(patched, offset + 32);
      offset += 46 + fileNameLength + extraLength + commentLength;
      continue;
    }

    if (signature === 0x06_05_4b_50) {
      break;
    }

    offset += 1;
  }

  return patched;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) + (bytes[offset + 1] ?? 0) * 0x01_00;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) +
    (bytes[offset + 1] ?? 0) * 0x01_00 +
    (bytes[offset + 2] ?? 0) * 0x01_00 ** 2 +
    (bytes[offset + 3] ?? 0) * 0x01_00 ** 3
  );
}
