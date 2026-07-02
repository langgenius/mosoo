import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";

type LinkKind = "image" | "link";

interface LinkCandidate {
  kind: LinkKind;
  line: number;
  sourcePath: string;
  target: string;
}

interface BrokenLink extends LinkCandidate {
  checkedPaths: string[];
}

const REPO_ROOT = process.cwd();
const IMAGE_EXTENSIONS = new Set([
  ".apng",
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const MARKDOWN_LINK_PATTERN = /(!)?\[[^\]\n]*\]\(([^)\n]+)\)/g;
const REFERENCE_LINK_PATTERN = /^\s{0,3}\[[^\]\n]+\]:\s+(\S+)/gm;
const HTML_IMAGE_SRC_PATTERN = /<(?:img|source|Image)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/g;
const IMAGE_PROPERTY_PATTERN =
  /\b(?:heroImage|image|ogImage|thumbnail|src)\s*:\s*["']([^"']+)["']/g;

function runGitLsFiles(patterns: readonly string[]): string[] {
  const result = Bun.spawnSync(["git", "ls-files", "-z", "--", ...patterns], {
    cwd: REPO_ROOT,
    stderr: "pipe",
    stdout: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString("utf8").trim();
    throw new Error(`git ls-files failed: ${stderr}`);
  }

  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0)
    .toSorted();
}

function toDisplayPath(path: string): string {
  return relative(REPO_ROOT, path).replaceAll("\\", "/");
}

function getLineNumber(text: string, index: number): number {
  let line = 1;

  for (let position = 0; position < index; position += 1) {
    if (text.charCodeAt(position) === 10) {
      line += 1;
    }
  }

  return line;
}

function parseMarkdownDestination(rawTarget: string): string | null {
  const trimmed = rawTarget.trim();

  if (trimmed.startsWith("<")) {
    const closingIndex = trimmed.indexOf(">");
    return closingIndex === -1 ? null : trimmed.slice(1, closingIndex);
  }

  const [destination] = trimmed.split(/\s+/);
  return destination ?? null;
}

function stripQueryAndAnchor(target: string): string {
  const hashIndex = target.indexOf("#");
  const queryIndex = target.indexOf("?");
  const cutIndexes = [hashIndex, queryIndex].filter((index) => index >= 0);

  if (cutIndexes.length === 0) {
    return target;
  }

  return target.slice(0, Math.min(...cutIndexes));
}

function decodePath(target: string): string {
  try {
    return decodeURI(target);
  } catch {
    return target;
  }
}

function normalizeTarget(rawTarget: string, kind: LinkKind): string | null {
  const parsedTarget = parseMarkdownDestination(rawTarget);
  if (parsedTarget === null) {
    return null;
  }

  const target = decodePath(stripQueryAndAnchor(parsedTarget.trim()));
  if (
    target.length === 0 ||
    parsedTarget.startsWith("#") ||
    target.startsWith("//") ||
    URI_SCHEME_PATTERN.test(target) ||
    target.includes("<") ||
    target.includes(">") ||
    target.includes("{{") ||
    target.includes("}}")
  ) {
    return null;
  }

  if (target.startsWith("/") && kind === "link") {
    return null;
  }

  return target;
}

function hasImageExtension(target: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(stripQueryAndAnchor(target)).toLowerCase());
}

function isInsideRepo(path: string): boolean {
  const relativePath = relative(REPO_ROOT, path);
  return relativePath.length === 0 || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function findAppPublicRoots(): string[] {
  const appsPath = resolve(REPO_ROOT, "apps");

  if (!existsSync(appsPath)) {
    return [];
  }

  return readdirSync(appsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(appsPath, entry.name, "public"))
    .filter((path) => existsSync(path));
}

function getCandidatePaths(sourcePath: string, target: string, kind: LinkKind): string[] {
  if (!target.startsWith("/")) {
    return [resolve(REPO_ROOT, dirname(sourcePath), target)];
  }

  if (kind !== "image") {
    return [];
  }

  const strippedTarget = target.replace(/^\/+/, "");
  const paths = [resolve(REPO_ROOT, strippedTarget)];

  for (const publicRoot of findAppPublicRoots()) {
    paths.push(resolve(publicRoot, strippedTarget));

    const appName = publicRoot.split("/").at(-2);
    if (appName !== undefined && strippedTarget.startsWith(`${appName}/`)) {
      paths.push(resolve(publicRoot, strippedTarget.slice(appName.length + 1)));
    }
  }

  return Array.from(new Set(paths));
}

function targetExists(path: string, kind: LinkKind): boolean {
  if (!isInsideRepo(path) || !existsSync(path)) {
    return false;
  }

  return kind === "image" ? statSync(path).isFile() : true;
}

function addCandidate(
  candidates: LinkCandidate[],
  sourcePath: string,
  text: string,
  index: number,
  rawTarget: string,
  kind: LinkKind,
): void {
  const target = normalizeTarget(rawTarget, kind);
  if (target === null) {
    return;
  }

  candidates.push({
    kind,
    line: getLineNumber(text, index),
    sourcePath,
    target,
  });
}

function extractCandidates(sourcePath: string, text: string): LinkCandidate[] {
  const candidates: LinkCandidate[] = [];

  for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) {
    addCandidate(
      candidates,
      sourcePath,
      text,
      match.index,
      match[2],
      match[1] === "!" ? "image" : "link",
    );
  }

  for (const match of text.matchAll(REFERENCE_LINK_PATTERN)) {
    addCandidate(candidates, sourcePath, text, match.index, match[1], "link");
  }

  for (const match of text.matchAll(HTML_IMAGE_SRC_PATTERN)) {
    addCandidate(candidates, sourcePath, text, match.index, match[1], "image");
  }

  for (const match of text.matchAll(IMAGE_PROPERTY_PATTERN)) {
    if (hasImageExtension(match[1])) {
      addCandidate(candidates, sourcePath, text, match.index, match[1], "image");
    }
  }

  return candidates;
}

function checkCandidate(candidate: LinkCandidate): BrokenLink | null {
  const checkedPaths = getCandidatePaths(candidate.sourcePath, candidate.target, candidate.kind);

  if (checkedPaths.some((path) => targetExists(path, candidate.kind))) {
    return null;
  }

  return {
    ...candidate,
    checkedPaths: checkedPaths.map(toDisplayPath),
  };
}

const files = runGitLsFiles(["*.md", "*.mdx"]);
const brokenLinks: BrokenLink[] = [];
const seenCandidates = new Set<string>();

for (const sourcePath of files) {
  const text = readFileSync(resolve(REPO_ROOT, sourcePath), "utf8");

  for (const candidate of extractCandidates(sourcePath, text)) {
    const key = `${candidate.sourcePath}:${candidate.line}:${candidate.kind}:${candidate.target}`;
    if (seenCandidates.has(key)) {
      continue;
    }

    seenCandidates.add(key);
    const brokenLink = checkCandidate(candidate);
    if (brokenLink !== null) {
      brokenLinks.push(brokenLink);
    }
  }
}

if (brokenLinks.length > 0) {
  console.error(`Found ${brokenLinks.length} broken local Markdown/MDX link(s).`);

  for (const brokenLink of brokenLinks) {
    console.error(
      `- ${brokenLink.sourcePath}:${brokenLink.line} ${brokenLink.kind} target ${JSON.stringify(
        brokenLink.target,
      )}`,
    );
    console.error(`  checked: ${brokenLink.checkedPaths.join(", ")}`);
  }

  process.exitCode = 1;
} else {
  console.log(`Docs link check passed for ${files.length} Markdown/MDX file(s).`);
}
