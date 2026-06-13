export const CONVENTIONAL_COMMIT_TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
] as const;

export const SUBJECT_MAX_LENGTH = 72;

const DISALLOWED_SUBJECT_PREFIXES = [/^\[codex\]/i, /^YEF-\d+:/i, /^WIP:/i, /^Draft:/i] as const;

export const DISALLOWED_AUTHOR_TOOL_NAME_PATTERNS = [
  /claude[-_\s]?code/i,
  /\bclaude\b/i,
  /\bcodex\b/i,
  /\bcursor\b/i,
  /\bcopilot\b/i,
  /\bopenai\b/i,
  /\bgemini\b/i,
  /\bgrok\b/i,
  /\baider\b/i,
  /\bdevin\b/i,
  /\bwindsurf\b/i,
  /\bcodegen\b/i,
  /\bopencode\b/i,
] as const;

export const DISALLOWED_AUTHOR_AUTOMATION_NAME_PATTERNS = [
  /github actions/i,
  /\bdependabot\b/i,
  /\brenovate\b/i,
] as const;

export const DISALLOWED_AUTHOR_BOT_NAME_PATTERNS = [/\[bot\]$/i, /\bbot\b/i] as const;

export const DISALLOWED_AUTHOR_NAME_PATTERNS = [
  ...DISALLOWED_AUTHOR_TOOL_NAME_PATTERNS,
  ...DISALLOWED_AUTHOR_AUTOMATION_NAME_PATTERNS,
  ...DISALLOWED_AUTHOR_BOT_NAME_PATTERNS,
] as const;

export const DISALLOWED_AUTHOR_EMAIL_PATTERNS = [
  /^agent@multica\.local$/i,
  /^[^@]+\[bot\]@users\.noreply\.github\.com$/i,
  /^agents?@/i,
  /^noreply@(?:openai|anthropic|cursor|copilot)\./i,
] as const;

const COMMIT_TRAILER_LINE_PATTERN = /^(?:Co-authored-by|Signed-off-by):\s*(.+)$/gim;
const GIT_IDENT_PATTERN = /^(.*?) <([^<>]*)> \d+ [+-]\d{4}$/;

const CONVENTIONAL_COMMIT_PATTERN =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))(!)?: [^\s].+$/;

const MERGE_COMMIT_PATTERN = /^Merge /;

export type CommitIdentityRole = "author" | "committer" | "trailer";

export interface PolicyViolation {
  rule: string;
  message: string;
}

export interface CommitIdentity {
  name: string;
  email: string;
}

export interface CommitMetadata {
  authorName: string;
  authorEmail: string;
  committerName?: string;
  committerEmail?: string;
  message: string;
}

function identityRulePrefix(role: CommitIdentityRole): string {
  return role;
}

export function firstLine(message: string): string {
  const line = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line;
}

export function isMergeCommitSubject(subject: string): boolean {
  return MERGE_COMMIT_PATTERN.test(subject);
}

export function parseTrailerIdentity(value: string): CommitIdentity {
  const trimmed = value.trim();
  const angled = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
  if (angled) {
    return { name: angled[1]?.trim() ?? "", email: angled[2]?.trim() ?? "" };
  }

  const emailOnly = trimmed.match(/^<([^>]+)>$/);
  if (emailOnly) {
    return { name: "", email: emailOnly[1]?.trim() ?? "" };
  }

  return { name: trimmed, email: "" };
}

export function parseGitIdentity(value: string): CommitIdentity | null {
  const match = value.trim().match(GIT_IDENT_PATTERN);
  if (!match) {
    return null;
  }

  return { name: match[1]?.trim() ?? "", email: match[2]?.trim() ?? "" };
}

export function listCommitTrailerIdentities(message: string): CommitIdentity[] {
  const identities: CommitIdentity[] = [];

  for (const match of message.matchAll(COMMIT_TRAILER_LINE_PATTERN)) {
    const rawValue = match[1]?.trim();
    if (!rawValue) {
      continue;
    }

    identities.push(parseTrailerIdentity(rawValue));
  }

  return identities;
}

export function validateCommitSubject(subject: string): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  if (subject.length === 0) {
    violations.push({
      rule: "non-empty-subject",
      message: "Commit subject must not be empty.",
    });
    return violations;
  }

  if (isMergeCommitSubject(subject)) {
    return violations;
  }

  for (const pattern of DISALLOWED_SUBJECT_PREFIXES) {
    if (pattern.test(subject)) {
      violations.push({
        rule: "disallowed-prefix",
        message: `Subject uses a disallowed prefix: "${subject}". Use type(scope): subject instead.`,
      });
    }
  }

  if (!CONVENTIONAL_COMMIT_PATTERN.test(subject)) {
    violations.push({
      rule: "conventional-commits",
      message:
        'Subject must match type(scope): subject (scope required), e.g. "feat(web): add help search".',
    });
  }

  const colonIndex = subject.indexOf(": ");
  if (colonIndex >= 0) {
    const body = subject.slice(colonIndex + 2);
    if (body.length > 0 && /[A-Z]/.test(body[0] ?? "")) {
      violations.push({
        rule: "subject-case",
        message: `Subject must start with a lower-case letter after ": ", got "${body}".`,
      });
    }
  }

  if (subject.length > SUBJECT_MAX_LENGTH) {
    violations.push({
      rule: "subject-length",
      message: `Subject is ${subject.length} characters; keep it at or below ${SUBJECT_MAX_LENGTH}.`,
    });
  }

  return violations;
}

function matchesDisallowedPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function validateAuthorIdentity(
  name: string,
  email: string,
  role: CommitIdentityRole = "author",
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const roleLabel = identityRulePrefix(role);

  if (name.length > 0 && matchesDisallowedPattern(name, DISALLOWED_AUTHOR_NAME_PATTERNS)) {
    violations.push({
      rule: `${roleLabel}-name`,
      message: `${capitalize(roleLabel)} name "${name}" looks like an agent identity. Use a real human contributor identity.`,
    });
  }

  if (email.length > 0 && matchesDisallowedPattern(email, DISALLOWED_AUTHOR_EMAIL_PATTERNS)) {
    violations.push({
      rule: `${roleLabel}-email`,
      message: `${capitalize(roleLabel)} email "${email}" looks like an agent identity. Use a real human contributor identity.`,
    });
  }

  return violations;
}

export function validateCommitBodyTrailers(message: string): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  for (const identity of listCommitTrailerIdentities(message)) {
    violations.push(...validateAuthorIdentity(identity.name, identity.email, "trailer"));
  }

  return violations;
}

export function validateCommitMessage(message: string): PolicyViolation[] {
  return validateCommitSubject(firstLine(message));
}

export function validateCommitMetadata(metadata: CommitMetadata): PolicyViolation[] {
  const violations = [
    ...validateCommitMessage(metadata.message),
    ...validateAuthorIdentity(metadata.authorName, metadata.authorEmail, "author"),
    ...validateCommitBodyTrailers(metadata.message),
  ];

  const hasCommitter =
    metadata.committerName &&
    metadata.committerEmail &&
    (metadata.committerName !== metadata.authorName ||
      metadata.committerEmail !== metadata.authorEmail);

  if (hasCommitter && metadata.committerName && metadata.committerEmail) {
    violations.push(
      ...validateAuthorIdentity(metadata.committerName, metadata.committerEmail, "committer"),
    );
  }

  return violations;
}

export function formatViolations(violations: readonly PolicyViolation[]): string {
  return violations.map((violation) => `- [${violation.rule}] ${violation.message}`).join("\n");
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
