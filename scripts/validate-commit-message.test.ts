import { expect, test } from "bun:test";

import { readResolvedGitIdentity } from "./validate-commit-message.ts";

test("readResolvedGitIdentity reads the resolved Git author ident", () => {
  const calls: string[][] = [];

  const identity = readResolvedGitIdentity("GIT_AUTHOR_IDENT", (args) => {
    calls.push([...args]);
    return "Ada Lovelace <ada@example.com> 1781333143 +0800";
  });

  expect(calls).toEqual([["var", "GIT_AUTHOR_IDENT"]]);
  expect(identity).toEqual({
    name: "Ada Lovelace",
    email: "ada@example.com",
  });
});
