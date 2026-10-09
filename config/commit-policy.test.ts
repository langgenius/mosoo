import { describe, expect, test } from "bun:test";

import {
  listCommitTrailerIdentities,
  parseGitIdentity,
  parseTrailerIdentity,
  validateAuthorIdentity,
  validateCommitBodyTrailers,
  validateCommitMetadata,
} from "./commit-policy.ts";

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
    expect(
      validateAuthorIdentity(
        "dependabot[bot]",
        "49699333+dependabot[bot]@users.noreply.github.com",
      ),
    ).toEqual([]);
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
