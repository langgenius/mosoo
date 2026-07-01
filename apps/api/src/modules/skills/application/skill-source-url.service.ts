import { isTruthy } from "../../../shared/truthiness";
import { SkillRequestError } from "./skill-package.shared";

export interface ParsedSkillSource {
  /** A canonical github.com URL the GitHub loader understands. */
  githubUrl: string;
  /** Optional skill selector (the `--skill <name>` value or a skills.sh slug segment). */
  skillName?: string;
}

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const SKILLS_SH_HOSTS = new Set(["skills.sh", "www.skills.sh"]);

/**
 * Normalizes the many shapes a user can paste into the "import from URL" field into a
 * canonical github.com URL (plus an optional skill selector):
 *   - a github.com repo / directory / SKILL.md URL (passed through unchanged)
 *   - a skills.sh skill URL, e.g. https://www.skills.sh/<owner>/<repo>/<skill>
 *   - the full install command copied from skills.sh,
 *     e.g. `npx skills add https://github.com/owner/repo --skill find-skills`
 *   - a repository URL plus a copied `--skill` flag
 */
export function parseSkillSourceUrl(raw: string): ParsedSkillSource {
  const trimmed = raw.trim();

  if (!trimmed) {
    throw new SkillRequestError("A skill URL or install command is required.");
  }

  if (!/^https?:\/\/\S+$/i.test(trimmed)) {
    return parseInstallCommand(trimmed);
  }

  return fromUrl(trimmed);
}

function parseInstallCommand(command: string): ParsedSkillSource {
  const tokens = command.split(/\s+/).filter(Boolean);
  const urlToken = tokens.find((token) => /^https?:\/\//i.test(token));

  if (!isTruthy(urlToken)) {
    throw new SkillRequestError(
      "Could not find a repository URL in the install command. Expected something like " +
        "`npx skills add https://github.com/owner/repo --skill name`.",
    );
  }

  const commandSkillName = readSkillFlag(tokens);
  const parsed = fromUrl(urlToken);

  return {
    githubUrl: parsed.githubUrl,
    ...(isTruthy(commandSkillName)
      ? { skillName: commandSkillName }
      : isTruthy(parsed.skillName)
        ? { skillName: parsed.skillName }
        : {}),
  };
}

function readSkillFlag(tokens: string[]): string | undefined {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;

    if (token === "--skill" || token === "-s") {
      const value = tokens[index + 1];
      return isTruthy(value) && !value.startsWith("-") ? value : undefined;
    }

    if (token.startsWith("--skill=")) {
      const value = token.slice("--skill=".length);
      return isTruthy(value) ? value : undefined;
    }
  }

  return undefined;
}

function fromUrl(rawUrl: string): ParsedSkillSource {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SkillRequestError("Invalid URL format.");
  }

  const host = parsed.hostname.toLowerCase();

  if (GITHUB_HOSTS.has(host)) {
    return { githubUrl: `https://github.com${parsed.pathname}` };
  }

  if (SKILLS_SH_HOSTS.has(host)) {
    return fromSkillsShUrl(parsed);
  }

  throw new SkillRequestError("Only github.com and skills.sh URLs are supported.");
}

function fromSkillsShUrl(parsed: URL): ParsedSkillSource {
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (segments.length < 2) {
    throw new SkillRequestError(
      "skills.sh URL is missing owner/repo. Expected https://skills.sh/<owner>/<repo>/<skill>.",
    );
  }

  const owner = segments[0]!;
  const repo = segments[1]!;
  const skillName = segments[2];

  return {
    githubUrl: `https://github.com/${owner}/${repo}`,
    ...(isTruthy(skillName) ? { skillName } : {}),
  };
}
