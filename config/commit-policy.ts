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

const DISALLOWED_AUTHOR_NAME_PATTERNS = [
  /claude/i,
  /codex/i,
  /前端工程师/i,
  /github actions/i,
  /\bbot\b/i,
] as const;

const DISALLOWED_AUTHOR_EMAIL_PATTERNS = [/^agent@multica\.local$/i] as const;

const CONVENTIONAL_COMMIT_PATTERN =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9._/-]+\))(!)?: [^\s].+$/;

const MERGE_COMMIT_PATTERN = /^Merge /;

export interface PolicyViolation {
  rule: string;
  message: string;
}

export function firstLine(message: string): string {
  const line = message.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line;
}

export function isMergeCommitSubject(subject: string): boolean {
  return MERGE_COMMIT_PATTERN.test(subject);
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

export function validateAuthorIdentity(name: string, email: string): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  for (const pattern of DISALLOWED_AUTHOR_NAME_PATTERNS) {
    if (pattern.test(name)) {
      violations.push({
        rule: "author-name",
        message: `Author name "${name}" looks like an agent identity. Use a real human contributor identity.`,
      });
    }
  }

  for (const pattern of DISALLOWED_AUTHOR_EMAIL_PATTERNS) {
    if (pattern.test(email)) {
      violations.push({
        rule: "author-email",
        message: `Author email "${email}" looks like an agent identity. Use a real human contributor identity.`,
      });
    }
  }

  return violations;
}

export function validateCommitMessage(message: string): PolicyViolation[] {
  return validateCommitSubject(firstLine(message));
}

export function formatViolations(violations: readonly PolicyViolation[]): string {
  return violations.map((violation) => `- [${violation.rule}] ${violation.message}`).join("\n");
}
