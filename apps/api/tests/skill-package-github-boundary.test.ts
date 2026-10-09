import { afterEach, describe, expect, test } from "bun:test";

import { zipSync } from "fflate";

import { loadSkillPackageFromGithub } from "../src/modules/skills/application/skill-package-github.service";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createGithubArchive(files: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, body]) => [path, new TextEncoder().encode(body)]),
    ),
  );
}

function githubArchiveResponse(files: Record<string, string>): Response {
  const archive = createGithubArchive(files);
  return new Response(archive, {
    headers: {
      "content-length": String(archive.byteLength),
    },
  });
}

describe("GitHub skill package boundary", () => {
  test("resolves tree URLs whose branch names contain slashes", async () => {
    const requestedUrls: string[] = [];
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;
      requestedUrls.push(url);

      if (url === "https://codeload.github.com/acme/repo/zip/release/2026") {
        return githubArchiveResponse({
          "repo-release-2026/skills/SKILL.md":
            "---\nname: slash-branch-skill\ndescription: branch ref test\n---\n# Skill\n",
        });
      }

      return new Response("Not Found", { status: 404 });
    };

    const normalized = await loadSkillPackageFromGithub(
      "https://github.com/acme/repo/tree/release/2026/skills",
    );

    expect(normalized.frontmatter.name).toBe("slash-branch-skill");
    expect(normalized.entries.map((entry) => entry.path)).toEqual(["SKILL.md"]);
    expect(requestedUrls).toEqual([
      "https://codeload.github.com/acme/repo/zip/release/2026/skills",
      "https://codeload.github.com/acme/repo/zip/release/2026",
    ]);
  });

  test("resolves a --skill selector to the skills/<name> directory", async () => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;

      if (url === "https://codeload.github.com/acme/repo/zip/HEAD") {
        return githubArchiveResponse({
          "repo-HEAD/README.md": "# Repo\n",
          "repo-HEAD/skills/find-skills/SKILL.md":
            "---\nname: find-skills\ndescription: find skills\n---\n# Find\n",
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const normalized = await loadSkillPackageFromGithub(
      "https://github.com/acme/repo",
      "find-skills",
    );

    expect(normalized.entries.map((entry) => entry.path)).toEqual(["SKILL.md"]);
    expect(normalized.frontmatter.name).toBe("find-skills");
  });

  test("resolves a --skill selector inside categorized skills directories", async () => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;

      if (url === "https://codeload.github.com/mattpocock/skills/zip/HEAD") {
        return githubArchiveResponse({
          "skills-HEAD/README.md": "# Skills\n",
          "skills-HEAD/skills/productivity/grill-me/SKILL.md":
            "---\nname: grill-me\ndescription: sharpen a plan\n---\n# Grill\n",
          "skills-HEAD/skills/productivity/grill-me/references/a.md": "# A\n",
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const normalized = await loadSkillPackageFromGithub(
      "https://github.com/mattpocock/skills",
      "grill-me",
    );

    expect(normalized.entries.map((entry) => entry.path)).toEqual([
      "references",
      "references/a.md",
      "SKILL.md",
    ]);
    expect(normalized.frontmatter.name).toBe("grill-me");
  });

  test("imports tree directories from the GitHub archive", async () => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;

      if (url === "https://codeload.github.com/acme/repo/zip/main") {
        return githubArchiveResponse({
          "repo-main/skills/SKILL.md":
            "---\nname: archived-skill\ndescription: archived skill\n---\n# Skill\n",
          "repo-main/skills/references/a.md": "# A\n",
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const normalized = await loadSkillPackageFromGithub(
      "https://github.com/acme/repo/tree/main/skills",
    );

    expect(normalized.entries.map((entry) => entry.path)).toEqual([
      "references",
      "references/a.md",
      "SKILL.md",
    ]);
    expect(normalized.frontmatter.name).toBe("archived-skill");
  });

  test("reports a clear error when the --skill selector is not found", async () => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;

      if (url === "https://codeload.github.com/acme/repo/zip/HEAD") {
        return githubArchiveResponse({
          "repo-HEAD/skills/other/SKILL.md":
            "---\nname: other\ndescription: other skill\n---\n# Other\n",
        });
      }

      return new Response("Not Found", { status: 404 });
    };

    await expect(
      loadSkillPackageFromGithub("https://github.com/acme/repo", "missing"),
    ).rejects.toThrow('Skill "missing" was not found in acme/repo');
  });

  test("inflates only the selected entries of the repository archive", async () => {
    const archive = createGithubArchive({
      "repo-main/other/unreadable.bin": "never inflated",
      "repo-main/skills/SKILL.md":
        "---\nname: archived-skill\ndescription: archived skill\n---\n# Skill\n",
    });
    // Inflating this entry would throw, so the import proves it was skipped.
    setCentralDirectoryCompression(archive, "repo-main/other/unreadable.bin", 99);
    globalThis.fetch = async () => new Response(archive);

    const normalized = await loadSkillPackageFromGithub(
      "https://github.com/acme/repo/tree/main/skills",
    );

    expect(normalized.entries.map((entry) => entry.path)).toEqual(["SKILL.md"]);
  });

  test("rejects an oversized selected file", async () => {
    globalThis.fetch = async () =>
      githubArchiveResponse({
        "repo-main/skills/SKILL.md":
          "---\nname: archived-skill\ndescription: archived skill\n---\n# Skill\n",
        "repo-main/skills/large.txt": "x".repeat(2 * 1024 * 1024 + 1),
      });

    await expect(
      loadSkillPackageFromGithub("https://github.com/acme/repo/tree/main/skills"),
    ).rejects.toThrow("GitHub file exceeds the limit (2 MB): large.txt");
  });
});

function setCentralDirectoryCompression(archive: Uint8Array, name: string, method: number): void {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const expectedName = new TextEncoder().encode(name);

  for (let offset = 0; offset + 46 <= archive.byteLength; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02_01_4b_50) {
      continue;
    }

    const nameStart = offset + 46;
    const entryName = archive.subarray(nameStart, nameStart + view.getUint16(offset + 28, true));

    if (
      entryName.length === expectedName.length &&
      entryName.every((byte, index) => byte === expectedName[index])
    ) {
      view.setUint16(offset + 10, method, true);
      return;
    }
  }

  throw new Error(`The archive has no central directory record for ${name}.`);
}
