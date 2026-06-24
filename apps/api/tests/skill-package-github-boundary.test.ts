import { afterEach, describe, expect, test } from "bun:test";

import { loadSkillPackageFromGithub } from "../src/modules/skills/application/skill-package-github.service";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockGithubContentPayload(payload: unknown): void {
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;

    if (url === "https://api.github.com/repos/acme/repo/branches?per_page=100") {
      return Response.json([{ name: "main" }]);
    }

    if (url === "https://api.github.com/repos/acme/repo/contents/skills?ref=main") {
      return Response.json(payload);
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };
}

describe("GitHub skill package boundary", () => {
  test("rejects malformed content entries instead of treating them as empty", async () => {
    mockGithubContentPayload([{ path: "skills/SKILL.md", type: "file" }]);

    await expect(
      loadSkillPackageFromGithub("https://github.com/acme/repo/tree/main/skills"),
    ).rejects.toThrow("GitHub content entry is invalid: skills/SKILL.md");
  });

  test("imports directory packages by downloading each listed file once", async () => {
    const fileBodies = new Map([
      [
        "https://raw.githubusercontent.com/acme/repo/main/skills/SKILL.md",
        "---\nname: github-skill\ndescription: test skill\n---\n# Skill\n",
      ],
      ["https://raw.githubusercontent.com/acme/repo/main/skills/references/a.md", "# A\n"],
      ["https://raw.githubusercontent.com/acme/repo/main/skills/references/b.md", "# B\n"],
    ]);
    const downloads = new Map<string, number>();

    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;

      if (url === "https://api.github.com/repos/acme/repo/branches?per_page=100") {
        return Response.json([{ name: "main" }]);
      }

      if (url === "https://api.github.com/repos/acme/repo/contents/skills?ref=main") {
        return Response.json([
          {
            download_url: "https://raw.githubusercontent.com/acme/repo/main/skills/SKILL.md",
            path: "skills/SKILL.md",
            type: "file",
          },
          {
            download_url: "https://raw.githubusercontent.com/acme/repo/main/skills/references/a.md",
            path: "skills/references/a.md",
            type: "file",
          },
          {
            download_url: "https://raw.githubusercontent.com/acme/repo/main/skills/references/b.md",
            path: "skills/references/b.md",
            type: "file",
          },
        ]);
      }

      const body = fileBodies.get(url);

      if (body !== undefined) {
        downloads.set(url, (downloads.get(url) ?? 0) + 1);
        return new Response(body, {
          headers: {
            "content-length": String(new TextEncoder().encode(body).byteLength),
          },
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
      "references/b.md",
      "SKILL.md",
    ]);
    expect(downloads).toEqual(new Map([...fileBodies.keys()].map((url) => [url, 1] as const)));
  });

  test("resolves a --skill selector to the skills/<name> directory", async () => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;

      if (url === "https://api.github.com/repos/acme/repo") {
        return Response.json({ default_branch: "main" });
      }

      // Probe order: skills/find-skills exists, so it is selected.
      if (url === "https://api.github.com/repos/acme/repo/contents/skills/find-skills?ref=main") {
        return Response.json([
          {
            download_url:
              "https://raw.githubusercontent.com/acme/repo/main/skills/find-skills/SKILL.md",
            path: "skills/find-skills/SKILL.md",
            type: "file",
          },
        ]);
      }

      if (url === "https://raw.githubusercontent.com/acme/repo/main/skills/find-skills/SKILL.md") {
        const body = "---\nname: find-skills\ndescription: find skills\n---\n# Find\n";
        return new Response(body, {
          headers: {
            "content-length": String(new TextEncoder().encode(body).byteLength),
          },
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

  test("reports a clear error when the --skill selector is not found", async () => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;

      if (url === "https://api.github.com/repos/acme/repo") {
        return Response.json({ default_branch: "main" });
      }

      return new Response("Not Found", { status: 404 });
    };

    await expect(
      loadSkillPackageFromGithub("https://github.com/acme/repo", "missing"),
    ).rejects.toThrow('Skill "missing" was not found in acme/repo');
  });
});
