import { describe, expect, test } from "bun:test";

import {
  validateAuthorIdentity,
  validateCommitMessage,
  validateCommitSubject,
} from "./commit-policy.ts";

describe("validateCommitSubject", () => {
  test("accepts a conventional commit with scope", () => {
    expect(validateCommitSubject("feat(web): add in-app help search")).toEqual([]);
  });

  test("rejects legacy codex prefix", () => {
    const violations = validateCommitSubject("[codex] Add API access publish panel");
    expect(violations.some((violation) => violation.rule === "disallowed-prefix")).toBe(true);
  });

  test("rejects missing scope", () => {
    const violations = validateCommitSubject("chore: relicense under vanilla Apache 2.0");
    expect(violations.some((violation) => violation.rule === "conventional-commits")).toBe(true);
  });

  test("allows standard merge commits", () => {
    expect(validateCommitSubject("Merge branch 'main' into feature/foo")).toEqual([]);
  });

  test("rejects long subjects", () => {
    const violations = validateCommitSubject(
      "docs(roadmap): drop version control/subscription/system log/file browser; add Telegram; defer cross-session memory; schedule multi-vendor for July",
    );
    expect(violations.some((violation) => violation.rule === "subject-length")).toBe(true);
  });
});

describe("validateAuthorIdentity", () => {
  test("accepts maintainer and external contributor identities", () => {
    expect(validateAuthorIdentity("Yevanchen", "cyefan2@gmail.com")).toEqual([]);
    expect(validateAuthorIdentity("External Contributor", "contributor@example.com")).toEqual([]);
  });

  test("rejects agent author identities", () => {
    const violations = validateAuthorIdentity("claude-code", "agent@multica.local");
    expect(violations.some((violation) => violation.rule === "author-name")).toBe(true);
    expect(violations.some((violation) => violation.rule === "author-email")).toBe(true);
  });
});

describe("validateCommitMessage", () => {
  test("uses only the first line of the commit message", () => {
    expect(validateCommitMessage("feat(web): add panel\n\nBody text with [codex] noise.")).toEqual(
      [],
    );
  });
});
