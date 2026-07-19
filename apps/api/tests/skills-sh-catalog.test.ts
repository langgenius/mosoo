import { afterEach, describe, expect, test } from "bun:test";

import {
  listSkillsShCatalog,
  parseSkillsShPublicCatalog,
  resolveSkillsShGitHubInstallTarget,
} from "../src/modules/skills/application/skills-sh-catalog.service";
import type { ApiBindings } from "../src/platform/cloudflare/worker-types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function publicCatalogHtml(
  skills: Array<{
    installs: number;
    isOfficial?: boolean;
    name: string;
    skillId: string;
    source: string;
  }>,
  total = skills.length,
): string {
  const escapedSkills = JSON.stringify(skills).replaceAll('"', '\\"');

  return `<script>self.__next_f.push([1,"4a:[\\"$\\",\\"$L51\\",null,{\\"initialSkills\\":${escapedSkills},\\"totalSkills\\":${total},\\"view\\":\\"all-time\\"}]"])</script>`;
}

describe("skills.sh catalog", () => {
  test("parses the public skills.sh directory payload", () => {
    const parsed = parseSkillsShPublicCatalog(
      publicCatalogHtml([
        {
          installs: 24531,
          isOfficial: true,
          name: "find-skills",
          skillId: "find-skills",
          source: "vercel-labs/skills",
        },
      ]),
    );

    expect(parsed.total).toBe(1);
    expect(parsed.skills).toEqual([
      {
        installs: 24531,
        isOfficial: true,
        name: "find-skills",
        skillId: "find-skills",
        source: "vercel-labs/skills",
      },
    ]);
  });

  test("uses the official API when a token is configured", async () => {
    globalThis.fetch = async (input, init) => {
      const url =
        input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
      const headers = new Headers(init?.headers);

      expect(url.toString()).toBe("https://skills.sh/api/v1/skills/search?q=react&limit=10");
      expect(headers.get("Authorization")).toBe("Bearer test-token");

      return Response.json({
        count: 1,
        data: [
          {
            id: "expo/skills/react-native",
            installUrl: "https://github.com/expo/skills",
            installs: 3842,
            name: "React Native",
            slug: "react-native",
            source: "expo/skills",
            sourceType: "github",
            url: "https://skills.sh/expo/skills/react-native",
          },
        ],
      });
    };

    const result = await listSkillsShCatalog({ SKILLS_SH_API_TOKEN: "test-token" } as ApiBindings, {
      perPage: "10",
      query: "react",
    });

    expect(result.authConfigured).toBe(true);
    expect(result.source).toBe("api");
    expect(result.total).toBe(1);
    expect(result.skills[0]).toMatchObject({
      id: "expo/skills/react-native",
      installUrl: "https://github.com/expo/skills",
      name: "React Native",
      slug: "react-native",
      source: "expo/skills",
    });
  });

  test("falls back to the public page and filters locally without a token", async () => {
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;

      expect(url).toBe("https://www.skills.sh/trending");

      return new Response(
        publicCatalogHtml(
          [
            {
              installs: 10,
              name: "React Native",
              skillId: "react-native",
              source: "expo/skills",
            },
            {
              installs: 5,
              name: "Workers Best Practices",
              skillId: "workers-best-practices",
              source: "cloudflare/skills",
            },
          ],
          2,
        ),
      );
    };

    const result = await listSkillsShCatalog({} as ApiBindings, {
      perPage: "10",
      query: "workers",
      view: "trending",
    });

    expect(result.authConfigured).toBe(false);
    expect(result.source).toBe("public-page");
    expect(result.total).toBe(1);
    expect(result.skills).toEqual([
      {
        id: "cloudflare/skills/workers-best-practices",
        installUrl: "https://github.com/cloudflare/skills",
        installs: 5,
        isDuplicate: false,
        isOfficial: false,
        name: "Workers Best Practices",
        slug: "workers-best-practices",
        source: "cloudflare/skills",
        sourceType: "github",
        url: "https://www.skills.sh/cloudflare/skills/workers-best-practices",
      },
    ]);
  });

  test("resolves a GitHub target for one-click fallback installs", () => {
    expect(
      resolveSkillsShGitHubInstallTarget({
        id: "vercel-labs/skills/find-skills",
        installUrl: "https://github.com/vercel-labs/skills",
        slug: "find-skills",
      }),
    ).toEqual({
      githubUrl: "https://github.com/vercel-labs/skills",
      skillName: "find-skills",
    });

    expect(
      resolveSkillsShGitHubInstallTarget({
        id: "skills.volces.com/byted-web-search",
        installUrl: "https://skills.volces.com",
        slug: "byted-web-search",
      }),
    ).toBeNull();
  });
});
