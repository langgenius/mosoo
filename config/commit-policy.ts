const DISALLOWED_AUTHOR_NAME_PATTERNS = [
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

const DISALLOWED_AUTHOR_EMAIL_PATTERNS = [
  /^agents?@/i,
  /^noreply@(?:openai|anthropic|cursor|copilot)\./i,
] as const;

const COMMIT_TRAILER_LINE_PATTERN = /^(?:Co-authored-by|Signed-off-by):\s*(.+)$/gim;
const GIT_IDENT_PATTERN = /^(.*?) <([^<>]*)> \d+ [+-]\d{4}$/;

type CommitIdentityRole = "author" | "committer" | "trailer";

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

function matchesDisallowedPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function validateAuthorIdentity(
  name: string,
  email: string,
  role: CommitIdentityRole = "author",
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  if (name.length > 0 && matchesDisallowedPattern(name, DISALLOWED_AUTHOR_NAME_PATTERNS)) {
    violations.push({
      rule: `${role}-name`,
      message: `${capitalize(role)} name "${name}" looks like an agent identity. Use a real human contributor identity.`,
    });
  }

  if (email.length > 0 && matchesDisallowedPattern(email, DISALLOWED_AUTHOR_EMAIL_PATTERNS)) {
    violations.push({
      rule: `${role}-email`,
      message: `${capitalize(role)} email "${email}" looks like an agent identity. Use a real human contributor identity.`,
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

export function validateCommitMetadata(metadata: CommitMetadata): PolicyViolation[] {
  const violations = [
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
