import { describe, expect, test } from "bun:test";

import { parseSkillSourceUrl } from "../src/modules/skills/application/skill-source-url.service";

describe("parseSkillSourceUrl", () => {
  test("passes through a github.com repo URL", () => {
    expect(parseSkillSourceUrl("https://github.com/acme/repo")).toEqual({
      githubUrl: "https://github.com/acme/repo",
    });
  });

  test("passes through a github.com directory URL unchanged", () => {
    expect(parseSkillSourceUrl("https://github.com/acme/repo/tree/main/skills/find")).toEqual({
      githubUrl: "https://github.com/acme/repo/tree/main/skills/find",
    });
  });

  test("maps a skills.sh skill page URL to a github repo plus skill selector", () => {
    expect(parseSkillSourceUrl("https://www.skills.sh/vercel-labs/skills/find-skills")).toEqual({
      githubUrl: "https://github.com/vercel-labs/skills",
      skillName: "find-skills",
    });
  });

  test("maps a skills.sh owner/repo URL without a skill selector", () => {
    expect(parseSkillSourceUrl("https://skills.sh/vercel-labs/skills")).toEqual({
      githubUrl: "https://github.com/vercel-labs/skills",
    });
  });

  test("parses the npx skills add install command", () => {
    expect(
      parseSkillSourceUrl(
        "npx skills add https://github.com/vercel-labs/skills --skill find-skills",
      ),
    ).toEqual({
      githubUrl: "https://github.com/vercel-labs/skills",
      skillName: "find-skills",
    });
  });

  test("parses the --skill=name form and other runners", () => {
    expect(
      parseSkillSourceUrl("pnpm dlx skills add https://github.com/acme/repo --skill=my-skill"),
    ).toEqual({
      githubUrl: "https://github.com/acme/repo",
      skillName: "my-skill",
    });
  });

  test("command --skill flag overrides a skills.sh slug skill", () => {
    expect(
      parseSkillSourceUrl(
        "npx skills add https://www.skills.sh/acme/repo/from-slug --skill from-flag",
      ),
    ).toEqual({
      githubUrl: "https://github.com/acme/repo",
      skillName: "from-flag",
    });
  });

  test("rejects unsupported hosts", () => {
    expect(() => parseSkillSourceUrl("https://example.com/acme/repo")).toThrow(
      "Only github.com and skills.sh URLs are supported.",
    );
  });

  test("rejects an empty value", () => {
    expect(() => parseSkillSourceUrl("   ")).toThrow("A skill URL or install command is required.");
  });

  test("rejects a command without a URL", () => {
    expect(() => parseSkillSourceUrl("npx skills add --skill find-skills")).toThrow(
      "Could not find a repository URL",
    );
  });
});
