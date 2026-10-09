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
import type { Zippable } from "fflate";

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

    expect(() =>
      normalizeSkillEntries({
        "SKILL.md": { body: markdown },
        "references/a.txt": { body: data },
        references: { body: data },
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

  test("accepts frontmatter fields it does not use", () => {
    expect(
      parseSkillMarkdown(
        "---\nname: Test\ndescription: Test skill.\ndependencies: python>=3.8, pandas>=1.5.0\nuser-invocable: yes\n---\n",
      ).frontmatter,
    ).toEqual({ description: "Test skill.", name: "Test" });
  });

  test("rejects prototype keys from extracted entries", () => {
    expect(() =>
      normalizeSkillEntries(
        toEntryRecord([
          { body: markdown, entryKind: "file", isExecutable: false, path: "SKILL.md" },
          { body: data, entryKind: "file", isExecutable: false, path: "__proto__" },
        ]),
      ),
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

  test("bounds and de-duplicates entries the central directory does not declare", () => {
    const underDeclared = zipWithUndeclaredEntries(
      { "SKILL.md": markdown },
      { "references/a.txt": data, "references/b.txt": data },
    );

    expect(extractZipArchive(underDeclared).map((entry) => entry.path)).toEqual([
      "SKILL.md",
      "references/a.txt",
      "references/b.txt",
    ]);
    expect(() => extractZipArchive(underDeclared, { maxEntryCount: 2 })).toThrow(
      "The ZIP entry count exceeds the limit (2).",
    );
    expect(() =>
      extractZipArchive(
        zipWithUndeclaredEntries(
          { "SKILL.md": markdown, "notes.txt": data },
          { "notes.txt": data },
        ),
      ),
    ).toThrow("The skill zip archive contains a duplicate entry: notes.txt");
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

// Streams the local entries of `declared` and then `undeclared`, while the
// central directory lists only `declared`.
function zipWithUndeclaredEntries(declared: Zippable, undeclared: Zippable): Uint8Array {
  const directoryArchive = zipSync(declared);
  const undeclaredArchive = zipSync(undeclared);
  const directoryStart = readUint32LE(directoryArchive, directoryArchive.byteLength - 6);
  const undeclaredLocals = undeclaredArchive.subarray(
    0,
    readUint32LE(undeclaredArchive, undeclaredArchive.byteLength - 6),
  );
  const archive = new Uint8Array(directoryArchive.byteLength + undeclaredLocals.byteLength);

  archive.set(directoryArchive.subarray(0, directoryStart));
  archive.set(undeclaredLocals, directoryStart);
  archive.set(
    directoryArchive.subarray(directoryStart),
    directoryStart + undeclaredLocals.byteLength,
  );
  new DataView(archive.buffer).setUint32(
    archive.byteLength - 6,
    directoryStart + undeclaredLocals.byteLength,
    true,
  );

  return archive;
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
