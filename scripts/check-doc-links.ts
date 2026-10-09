import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

type LinkKind = "image" | "link";

interface LinkCandidate {
  kind: LinkKind;
  line: number;
  sourcePath: string;
  target: string;
}

const REPO_ROOT = process.cwd();
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const MARKDOWN_LINK_PATTERN = /(!)?\[[^\]\n]*\]\(([^)\n]+)\)/g;
const HTML_IMAGE_SRC_PATTERN = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/g;

function listMarkdownFiles(): string[] {
  const result = Bun.spawnSync(["git", "ls-files", "-z", "--", "*.md"], {
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

function normalizeTarget(rawTarget: string): string | null {
  const parsedTarget = parseMarkdownDestination(rawTarget);
  if (parsedTarget === null) {
    return null;
  }

  const target = decodePath(stripQueryAndAnchor(parsedTarget.trim()));
  if (
    target.length === 0 ||
    parsedTarget.startsWith("#") ||
    target.startsWith("/") ||
    URI_SCHEME_PATTERN.test(target) ||
    target.includes("<") ||
    target.includes(">")
  ) {
    return null;
  }

  return target;
}

function targetExists(path: string, kind: LinkKind): boolean {
  const relativePath = relative(REPO_ROOT, path);

  if (relativePath.startsWith("..") || isAbsolute(relativePath) || !existsSync(path)) {
    return false;
  }

  return kind === "image" ? statSync(path).isFile() : true;
}

function extractCandidates(sourcePath: string, text: string): LinkCandidate[] {
  const matches = [
    ...[...text.matchAll(MARKDOWN_LINK_PATTERN)].map((match) => ({
      index: match.index,
      kind: match[1] === "!" ? ("image" as const) : ("link" as const),
      rawTarget: match[2] ?? "",
    })),
    ...[...text.matchAll(HTML_IMAGE_SRC_PATTERN)].map((match) => ({
      index: match.index,
      kind: "image" as const,
      rawTarget: match[1] ?? "",
    })),
  ];

  return matches.flatMap(({ index, kind, rawTarget }) => {
    const target = normalizeTarget(rawTarget);
    return target === null ? [] : [{ kind, line: getLineNumber(text, index), sourcePath, target }];
  });
}

const files = listMarkdownFiles();
const brokenLinks: (LinkCandidate & { checkedPath: string })[] = [];

for (const sourcePath of files) {
  const text = readFileSync(resolve(REPO_ROOT, sourcePath), "utf8");

  for (const candidate of extractCandidates(sourcePath, text)) {
    const checkedPath = resolve(REPO_ROOT, dirname(sourcePath), candidate.target);

    if (!targetExists(checkedPath, candidate.kind)) {
      brokenLinks.push({ ...candidate, checkedPath: relative(REPO_ROOT, checkedPath) });
    }
  }
}

if (brokenLinks.length > 0) {
  console.error(`Found ${brokenLinks.length} broken local Markdown link(s).`);

  for (const brokenLink of brokenLinks) {
    console.error(
      `- ${brokenLink.sourcePath}:${brokenLink.line} ${brokenLink.kind} target ${JSON.stringify(
        brokenLink.target,
      )}`,
    );
    console.error(`  checked: ${brokenLink.checkedPath}`);
  }

  process.exitCode = 1;
} else {
  console.log(`Docs link check passed for ${files.length} Markdown file(s).`);
}
