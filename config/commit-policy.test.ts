import { describe, expect, test } from "bun:test";

import {
  listCommitTrailerIdentities,
  parseGitIdentity,
  parseTrailerIdentity,
  validateAuthorIdentity,
  validateCommitBodyTrailers,
  validateCommitMessage,
  validateCommitMetadata,
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

describe("parseTrailerIdentity", () => {
  test("parses name and email trailers", () => {
    expect(parseTrailerIdentity("Claude <agent@multica.local>")).toEqual({
      name: "Claude",
      email: "agent@multica.local",
    });
  });
});

describe("parseGitIdentity", () => {
  test("parses resolved Git ident output", () => {
    expect(parseGitIdentity("Ada Lovelace <ada@example.com> 1781333143 +0800")).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
  });

  test("rejects non-ident output", () => {
    expect(parseGitIdentity("Ada Lovelace <ada@example.com>")).toBeNull();
  });
});

describe("listCommitTrailerIdentities", () => {
  test("collects co-authored-by and signed-off-by trailers", () => {
    expect(
      listCommitTrailerIdentities(
        [
          "feat(web): add panel",
          "",
          "Co-authored-by: Cursor <noreply@cursor.com>",
          "Signed-off-by: Ada Lovelace <ada@example.com>",
        ].join("\n"),
      ),
    ).toEqual([
      { name: "Cursor", email: "noreply@cursor.com" },
      { name: "Ada Lovelace", email: "ada@example.com" },
    ]);
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

  test("rejects underscore claude code aliases", () => {
    expect(
      validateAuthorIdentity("claude_code", "dev@example.com").some(
        (v) => v.rule === "author-name",
      ),
    ).toBe(true);
  });

  test("rejects common coding-agent tool names", () => {
    expect(
      validateAuthorIdentity("Cursor", "dev@example.com").some((v) => v.rule === "author-name"),
    ).toBe(true);
    expect(
      validateAuthorIdentity("GitHub Copilot", "dev@example.com").some(
        (v) => v.rule === "author-name",
      ),
    ).toBe(true);
    expect(
      validateAuthorIdentity("dependabot[bot]", "dependabot[bot]@users.noreply.github.com").length,
    ).toBeGreaterThan(0);
  });
});

describe("validateCommitBodyTrailers", () => {
  test("rejects agent identities in co-authored-by trailers", () => {
    const violations = validateCommitBodyTrailers(
      ["feat(web): add panel", "", "Co-authored-by: Claude <agent@multica.local>"].join("\n"),
    );
    expect(violations.some((violation) => violation.rule === "trailer-name")).toBe(true);
    expect(violations.some((violation) => violation.rule === "trailer-email")).toBe(true);
  });

  test("accepts human co-authored-by trailers", () => {
    expect(
      validateCommitBodyTrailers(
        ["feat(web): add panel", "", "Co-authored-by: Ada Lovelace <ada@example.com>"].join("\n"),
      ),
    ).toEqual([]);
  });
});

describe("validateCommitMessage", () => {
  test("uses only the first line of the commit message", () => {
    expect(validateCommitMessage("feat(web): add panel\n\nBody text with [codex] noise.")).toEqual(
      [],
    );
  });
});

describe("validateCommitMetadata", () => {
  test("rejects agent committer identity", () => {
    const violations = validateCommitMetadata({
      authorName: "Ada Lovelace",
      authorEmail: "ada@example.com",
      committerName: "claude-code",
      committerEmail: "agent@multica.local",
      message: "feat(web): add panel",
    });

    expect(violations.some((violation) => violation.rule === "committer-name")).toBe(true);
    expect(violations.some((violation) => violation.rule === "committer-email")).toBe(true);
  });
});
