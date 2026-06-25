import { useSyncExternalStore } from "react";

export type SessionFileStatus = "uploading" | "available" | "failed";

export interface SessionFile {
  createdAt: string;
  id: string;
  mimeType?: string | null;
  name: string;
  progress?: number;
  size: number;
  status: SessionFileStatus;
}

interface State {
  deleteConfirmFor: string | null;
  pendingBySession: Record<string, SessionFile[]>;
}

let state: State = {
  deleteConfirmFor: null,
  pendingBySession: {},
};

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function setState(patch: Partial<State> | ((prev: State) => Partial<State>)): void {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  notify();
}

function snapshot(): State {
  return state;
}

function createUiId(): string {
  return crypto.randomUUID();
}

function updatePendingFile(
  sessionId: string,
  fileId: string,
  update: (file: SessionFile) => SessionFile | null,
): void {
  setState((prev) => {
    const current = prev.pendingBySession[sessionId] ?? [];
    const nextFiles = current.flatMap((file) => {
      if (file.id !== fileId) {
        return [file];
      }

      const updated = update(file);
      return updated ? [updated] : [];
    });

    return {
      pendingBySession: {
        ...prev.pendingBySession,
        [sessionId]: nextFiles,
      },
    };
  });
}

function subscribeSessionFiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSessionFilesStore(): State {
  return useSyncExternalStore(subscribeSessionFiles, snapshot, snapshot);
}

export function startSessionFileUpload(sessionId: string, file: File): string {
  const id = createUiId();
  const pendingFile: SessionFile = {
    createdAt: new Date().toISOString(),
    id,
    mimeType: file.type || null,
    name: file.name,
    progress: 8,
    size: file.size,
    status: "uploading",
  };

  setState((prev) => ({
    pendingBySession: {
      ...prev.pendingBySession,
      [sessionId]: [pendingFile, ...(prev.pendingBySession[sessionId] ?? [])],
    },
  }));

  return id;
}

export function markSessionFileUploadProgress(
  sessionId: string,
  fileId: string,
  progress: number,
): void {
  updatePendingFile(sessionId, fileId, (file) => ({
    ...file,
    progress: Math.min(95, Math.max(file.progress ?? 0, progress)),
  }));
}

export function completeSessionFileUpload(sessionId: string, fileId: string): void {
  updatePendingFile(sessionId, fileId, () => null);
}

export function failSessionFileUpload(sessionId: string, fileId: string): void {
  updatePendingFile(sessionId, fileId, (file) => ({
    ...file,
    progress: 100,
    status: "failed",
  }));
}
