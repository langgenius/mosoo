import { afterEach, describe, expect, test } from "bun:test";

import { createZipArchive } from "@mosoo/skill-package";
import { zipSync } from "fflate";

import { inspectSkillInput } from "../src/modules/skills/application/skill-package-source.service";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const textEncoder = new TextEncoder();

function encode(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function markdownSkill(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} description\n---\n# ${name}\n`;
}

function createGithubArchive(files: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([path, body]) => [path, encode(body)])),
  );
}

describe("inspectSkillInput", () => {
  test("inspects a markdown skill upload", async () => {
    const inspected = await inspectSkillInput({
      file: {
        bytes: encode(markdownSkill("markdown-skill")),
        name: "SKILL.md",
      },
    });

    expect(inspected.frontmatter.name).toBe("markdown-skill");
    expect(inspected.entries.map((entry) => entry.path)).toEqual(["SKILL.md"]);
  });

  test("inspects a zip skill upload", async () => {
    const archive = createZipArchive([
      {
        body: encode(markdownSkill("zip-skill")),
        entryKind: "file",
        isExecutable: false,
        path: "SKILL.md",
      },
    ]);

    const inspected = await inspectSkillInput({
      file: {
        bytes: archive,
        name: "zip-skill.zip",
      },
    });

    expect(inspected.frontmatter.name).toBe("zip-skill");
    expect(inspected.entries.map((entry) => entry.path)).toEqual(["SKILL.md"]);
  });

  test("inspects a .skill upload", async () => {
    const archive = createZipArchive([
      {
        body: encode(markdownSkill("packed-skill")),
        entryKind: "file",
        isExecutable: false,
        path: "SKILL.md",
      },
    ]);

    const inspected = await inspectSkillInput({
      file: {
        bytes: archive,
        name: "packed.skill",
      },
    });

    expect(inspected.frontmatter.name).toBe("packed-skill");
    expect(inspected.entries.map((entry) => entry.path)).toEqual(["SKILL.md"]);
  });

  test("inspects a skills.sh skill URL", async () => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;

      if (url === "https://codeload.github.com/acme/repo/zip/HEAD") {
        const archive = createGithubArchive({
          "repo-HEAD/skills/productivity/grill-me/SKILL.md": markdownSkill("grill-me"),
        });
        return new Response(archive, {
          headers: {
            "content-length": String(archive.byteLength),
          },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    const inspected = await inspectSkillInput({
      githubUrl: "https://www.skills.sh/acme/repo/grill-me",
    });

    expect(inspected.frontmatter.name).toBe("grill-me");
    expect(inspected.entries.map((entry) => entry.path)).toEqual(["SKILL.md"]);
  });
});
