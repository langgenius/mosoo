import { describe, expect, test } from "bun:test";

import {
  appendSessionResourceMentionsToMessage,
  createSessionResourceMentionMessagePayload,
} from "../src/features/session-chat/session-resource-mentions";
import type { SessionResourceMention } from "../src/features/session-chat/session-resource-mentions";

function mention(path: string, name = path, id = path): SessionResourceMention {
  return { id, name, path };
}

describe("appendSessionResourceMentionsToMessage", () => {
  test("appends the plain sandbox-relative path without an '@' prefix", () => {
    const result = appendSessionResourceMentionsToMessage("translate to english", [
      mention("session-files/01KVQ/mosoo Product Concept (standalone).html"),
    ]);

    expect(result).toBe(
      "translate to english\n\nsession-files/01KVQ/mosoo Product Concept (standalone).html",
    );
    // The agent runtime does not resolve "@" mentions; a prefixed path would be
    // read verbatim and fail as "file not exist". See YEF-713.
    expect(result).not.toContain("@session-files");
  });

  test("returns only the paths when the message is empty", () => {
    const result = appendSessionResourceMentionsToMessage("   ", [
      mention("session-files/a/one.txt"),
      mention("session-files/b/two.txt"),
    ]);

    expect(result).toBe("session-files/a/one.txt\nsession-files/b/two.txt");
  });

  test("deduplicates mentions that share a path", () => {
    const result = appendSessionResourceMentionsToMessage("look", [
      mention("session-files/a/one.txt"),
      mention("session-files/a/one.txt"),
    ]);

    expect(result).toBe("look\n\nsession-files/a/one.txt");
  });

  test("leaves the message untouched when there are no mentions", () => {
    expect(appendSessionResourceMentionsToMessage("hello", [])).toBe("hello");
  });
});

describe("createSessionResourceMentionMessagePayload", () => {
  test("keeps the readable paths and includes attachment ids for the stream event", () => {
    const payload = createSessionResourceMentionMessagePayload({
      mentions: [
        mention("session-files/file-a/one.txt", "one.txt", "file-a"),
        mention("session-files/file-b/two.txt", "two.txt", "file-b"),
      ],
      message: "summarize these",
    });

    expect(payload).toEqual({
      attachmentIds: ["file-a", "file-b"],
      text: "summarize these\n\nsession-files/file-a/one.txt\nsession-files/file-b/two.txt",
    });
  });
});
