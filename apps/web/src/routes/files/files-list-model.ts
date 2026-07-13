import type { FileSessionKind } from "@mosoo/contracts/file";

import type { ListedFileEntry } from "@/domains/file/api/files";

export type SessionKindFilter = "all" | FileSessionKind;

export interface FilesAgentOption {
  id: string;
  name: string;
}

export interface FilesSessionOption {
  agentId: string;
  id: string;
  title: string | null;
}

export interface FilesFilterSelection {
  agentId: string;
  search: string;
  sessionId: string;
  sessionKind: SessionKindFilter;
}

export type FileAgentRelation = "created" | "reads";

export interface FileAgentAttribution {
  id: string;
  name: string;
  relation: FileAgentRelation;
}

export interface FilesTableEntry extends ListedFileEntry {
  agent: FileAgentAttribution | null;
}

export interface FilesViewModel {
  agentId: string;
  agentOptions: FilesAgentOption[];
  files: FilesTableEntry[];
  sessionId: string;
  sessionOptions: FilesSessionOption[];
}

function matchesSearch(file: ListedFileEntry, search: string): boolean {
  const normalized = search.trim().toLowerCase();

  if (!normalized) {
    return true;
  }

  return [file.name, file.path, file.id, file.mimeType ?? ""].some((value) =>
    value.toLowerCase().includes(normalized),
  );
}

function toAgentAttribution(
  file: ListedFileEntry,
  sessionById: Map<string, FilesSessionOption>,
  agentNameById: Map<string, string>,
): FileAgentAttribution | null {
  if (file.sessionId === null || file.sessionKind === null) {
    return null;
  }

  const session = sessionById.get(file.sessionId);

  if (session === undefined) {
    return null;
  }

  return {
    id: session.agentId,
    name: agentNameById.get(session.agentId) ?? session.agentId,
    relation: file.sessionKind === "artifact" ? "created" : "reads",
  };
}

export function createFilesViewModel(
  files: ListedFileEntry[],
  sessions: FilesSessionOption[],
  agents: FilesAgentOption[],
  selection: FilesFilterSelection,
): FilesViewModel {
  const sessionIdsWithFiles = new Set<string>(
    files.flatMap((file) => (file.sessionId === null ? [] : [file.sessionId])),
  );
  const sessionsWithFiles = sessions.filter((session) => sessionIdsWithFiles.has(session.id));
  const agentIdsWithFiles = new Set(sessionsWithFiles.map((session) => session.agentId));
  const agentNameById = new Map(agents.map((agent) => [agent.id, agent.name]));
  const agentOptions = [...agentIdsWithFiles]
    .map((agentId) => ({
      id: agentId,
      name: agentNameById.get(agentId) ?? agentId,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const agentId = agentOptions.some((agent) => agent.id === selection.agentId)
    ? selection.agentId
    : "";
  const sessionOptions = sessionsWithFiles.filter(
    (session) => agentId === "" || session.agentId === agentId,
  );
  const sessionId = sessionOptions.some((session) => session.id === selection.sessionId)
    ? selection.sessionId
    : "";
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const visibleFiles = files
    .filter((file) => {
      if (selection.sessionKind !== "all" && file.sessionKind !== selection.sessionKind) {
        return false;
      }

      if (sessionId !== "" && file.sessionId !== sessionId) {
        return false;
      }

      if (agentId !== "") {
        const session = file.sessionId === null ? undefined : sessionById.get(file.sessionId);

        if (session?.agentId !== agentId) {
          return false;
        }
      }

      return matchesSearch(file, selection.search);
    })
    .map((file) =>
      Object.assign({}, file, {
        agent: toAgentAttribution(file, sessionById, agentNameById),
      }),
    );

  return {
    agentId,
    agentOptions,
    files: visibleFiles,
    sessionId,
    sessionOptions,
  };
}
