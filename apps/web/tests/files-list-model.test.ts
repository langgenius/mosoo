import { describe, expect, test } from "bun:test";

import type { FileSessionKind } from "@mosoo/contracts/file";

import type { ListedFileEntry } from "../src/domains/file/api/files";
import { createFilesViewModel } from "../src/routes/files/files-list-model";
import { toAccountId, toFileId, toSessionId } from "../src/routes/typed-id";

const ACCOUNT_ID = toAccountId("01J000000000000000000000A1");
const FIRST_SESSION_ID = toSessionId("01J000000000000000000000S1");
const EMPTY_SESSION_ID = toSessionId("01J000000000000000000000S2");
const SECOND_SESSION_ID = toSessionId("01J000000000000000000000S3");

function createFile(
  id: string,
  sessionId: string | null,
  sessionKind: FileSessionKind | null,
): ListedFileEntry {
  return {
    createdAt: "2026-07-13T00:00:00.000Z",
    createdBy: ACCOUNT_ID,
    etag: "etag",
    expiresAt: null,
    id: toFileId(id),
    mimeType: "text/markdown",
    name: `${id}.md`,
    path: `${id}.md`,
    sessionId: sessionId === null ? null : toSessionId(sessionId),
    sessionKind,
    sourcePath: sessionKind === "artifact" ? `outputs/${id}.md` : null,
    size: 32,
    status: "ready",
    updatedAt: "2026-07-13T00:00:00.000Z",
    version: 1,
  };
}

const files = [
  createFile("01J000000000000000000000F1", FIRST_SESSION_ID, "artifact"),
  createFile("01J000000000000000000000F2", SECOND_SESSION_ID, "attachment"),
  createFile("01J000000000000000000000F3", null, null),
];
const sessions = [
  { agentId: "agent-a", id: FIRST_SESSION_ID, title: "First result" },
  { agentId: "agent-a", id: EMPTY_SESSION_ID, title: "Empty Thread" },
  { agentId: "agent-b", id: SECOND_SESSION_ID, title: "Second result" },
];
const agents = [
  { id: "agent-a", name: "Alpha" },
  { id: "agent-b", name: "Beta" },
  { id: "agent-c", name: "No files" },
];

describe("Files list model", () => {
  test("only offers Agents and Threads that own files", () => {
    const view = createFilesViewModel(files, sessions, agents, {
      agentId: "",
      search: "",
      sessionId: "",
      sessionKind: "all",
    });

    expect(view.agentOptions).toEqual([
      { id: "agent-a", name: "Alpha" },
      { id: "agent-b", name: "Beta" },
    ]);
    expect(view.sessionOptions.map((session) => session.id)).toEqual([
      FIRST_SESSION_ID,
      SECOND_SESSION_ID,
    ]);
    expect(view.sessionOptions.map((session) => session.id)).not.toContain(EMPTY_SESSION_ID);
    expect(view.files.map((file) => file.agent)).toEqual([
      { id: "agent-a", name: "Alpha", relation: "created" },
      { id: "agent-b", name: "Beta", relation: "reads" },
      null,
    ]);
  });

  test("filters files and Thread options by the selected Agent", () => {
    const view = createFilesViewModel(files, sessions, agents, {
      agentId: "agent-a",
      search: "",
      sessionId: "",
      sessionKind: "artifact",
    });

    expect(view.sessionOptions.map((session) => session.id)).toEqual([FIRST_SESSION_ID]);
    expect(view.files.map((file) => file.id)).toEqual([files[0]?.id]);
  });

  test("drops stale filter ids instead of hiding the whole list", () => {
    const view = createFilesViewModel(files, sessions, agents, {
      agentId: "missing-agent",
      search: "",
      sessionId: "missing-session",
      sessionKind: "all",
    });

    expect(view.agentId).toBe("");
    expect(view.sessionId).toBe("");
    expect(view.files).toHaveLength(3);
  });
});
