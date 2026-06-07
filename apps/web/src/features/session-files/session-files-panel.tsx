import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, FolderOpen, Plus, Trash2, Upload, X } from "lucide-react";
import type { ChangeEvent } from "react";
import { useRef } from "react";

import {
  listSessionResources,
  removeSessionResource,
  sessionResourcesQueryKey,
} from "@/domains/session/api/session-resources";
import { apiPath } from "@/platform/http/public-api";
import { toFileId, toNullableSessionId, toSessionId } from "@/routes/typed-id";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";

import { isTruthy } from "../../shared/lib/truthiness";
import {
  closeDeleteConfirm,
  closeDeleteConfirmFor,
  dismissFailedSessionFile,
  openDeleteConfirm,
  useSessionFilesStore,
} from "./session-files-store";
import type { SessionFile } from "./session-files-store";
const SESSION_FILE_LIMIT = 100;

function toAvailableSessionFile(
  resource: Awaited<ReturnType<typeof listSessionResources>>[number],
) {
  return {
    createdAt: resource.createdAt,
    id: resource.id,
    mimeType: resource.mimeType,
    name: resource.name,
    size: resource.size,
    status: "available" as const,
  } satisfies SessionFile;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(iso: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function FileRow({ file, onRemove }: { file: SessionFile; onRemove: (file: SessionFile) => void }) {
  const { deleteConfirmFor } = useSessionFilesStore();
  const isConfirming = deleteConfirmFor === file.id;
  const isUploading = file.status === "uploading";
  const isFailed = file.status === "failed";
  const canDownload = file.status === "available";

  return (
    <div
      className={cn(
        "group relative rounded-md border border-border-subtle bg-card px-3 py-2.5 transition-colors",
        isFailed ? "border-destructive/30 bg-destructive/[0.04]" : "hover:bg-paper-100",
      )}
    >
      <div className="flex items-start gap-2.5">
        <FileText
          className={cn("mt-0.5 size-4 shrink-0", isFailed ? "text-destructive" : "text-fg-3")}
        />
        <div className="min-w-0 flex-1">
          <div className="text-fg-1 truncate text-[13px] font-medium" title={file.name}>
            {file.name}
          </div>
          <div className="text-fg-3 mt-0.5 flex items-center gap-1.5 text-[11px]">
            <span>{formatSize(file.size)}</span>
            {!isUploading && !isFailed ? (
              <>
                <span className="opacity-50">·</span>
                <span>{formatRelativeTime(file.createdAt)}</span>
              </>
            ) : null}
            {isFailed ? (
              <>
                <span className="opacity-50">·</span>
                <span className="text-destructive">Upload failed</span>
              </>
            ) : null}
          </div>

          {isUploading ? (
            <div className="mt-2 flex items-center gap-2">
              <div className="bg-ink-900/[0.08] h-1.5 flex-1 overflow-hidden rounded-full">
                <div
                  className="bg-accent h-full rounded-full transition-[width] duration-200"
                  style={{ width: `${file.progress ?? 0}%` }}
                />
              </div>
              <span className="text-fg-3 text-[10.5px] font-medium tabular-nums">
                {Math.round(file.progress ?? 0)}%
              </span>
            </div>
          ) : null}
        </div>

        {!isUploading ? (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              aria-label="Download"
              disabled={!canDownload}
              onClick={() => {
                if (canDownload) {
                  globalThis.location.assign(
                    apiPath(`/files/${file.id}/content?disposition=attachment`),
                  );
                }
              }}
              className="text-fg-3 hover:bg-ink-900/[0.06] hover:text-fg-1 inline-flex size-7 items-center justify-center rounded-md"
            >
              <Download className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Delete"
              onClick={() => {
                openDeleteConfirm(file.id);
              }}
              className="text-fg-3 hover:bg-destructive/10 hover:text-destructive inline-flex size-7 items-center justify-center rounded-md"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ) : null}
      </div>

      {isConfirming ? (
        <div className="absolute inset-x-0 bottom-0 z-10 translate-y-full pt-1.5">
          <div className="border-border bg-card rounded-md border px-3 py-2.5 shadow-md">
            <div className="text-fg-1 text-[12px] font-medium">Delete this file?</div>
            <div className="text-fg-3 mt-0.5 text-[11px]">
              This is permanent. The agent will no longer see it from the next turn.
            </div>
            <div className="mt-2 flex justify-end gap-1.5">
              <Button onClick={closeDeleteConfirm} size="xs" variant="ghost">
                Cancel
              </Button>
              <Button
                onClick={() => {
                  onRemove(file);
                }}
                size="xs"
                variant="destructive"
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({
  onPick,
  uploadDisabled,
  uploadDisabledReason,
}: {
  onPick: () => void;
  uploadDisabled: boolean;
  uploadDisabledReason: string | null;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="bg-paper-200 text-fg-3 flex size-12 items-center justify-center rounded-full">
        <FolderOpen className="size-5" />
      </div>
      <div className="text-fg-1 mt-3 text-[13px] font-medium">No files yet</div>
      <div className="text-fg-3 mt-1 text-[12px] leading-relaxed">
        Drop files here, or use the paperclip in the composer.
        <br />
        Anything you add stays available to the agent across this session.
      </div>
      {uploadDisabledReason !== null ? (
        <div className="text-fg-3 mt-3 max-w-[240px] text-[12px] leading-relaxed">
          {uploadDisabledReason}
        </div>
      ) : null}
      <Button
        className="mt-4 gap-1.5"
        disabled={uploadDisabled}
        onClick={onPick}
        size="sm"
        variant="outline"
      >
        <Upload className="size-3.5" />
        Add files
      </Button>
    </div>
  );
}

export function SessionFilesPanel({
  onClose,
  onUploadFiles,
  sessionId,
  uploadDisabled = false,
  uploadDisabledReason = null,
}: {
  onClose: () => void;
  onUploadFiles: (files: File[]) => void;
  sessionId: string | null;
  uploadDisabled?: boolean;
  uploadDisabledReason?: string | null;
}) {
  const { pendingBySession } = useSessionFilesStore();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resourcesQuery = useQuery({
    enabled: sessionId !== null,
    queryFn: async () => listSessionResources(toSessionId(sessionId!)),
    queryKey: sessionResourcesQueryKey(toNullableSessionId(sessionId)),
  });
  const pendingFiles = isTruthy(sessionId) ? (pendingBySession[sessionId] ?? []) : [];
  const availableFiles = (resourcesQuery.data ?? []).map(toAvailableSessionFile);
  const files = [...pendingFiles, ...availableFiles];
  const atLimit = files.length >= SESSION_FILE_LIMIT;

  const handleFiles = (event: ChangeEvent<HTMLInputElement>): void => {
    const list = event.target.files;

    if (!list) {
      return;
    }

    if (uploadDisabled) {
      event.target.value = "";
      return;
    }

    onUploadFiles([...list]);

    event.target.value = "";
  };

  const triggerPicker = (): void => {
    if (!uploadDisabled) {
      inputRef.current?.click();
    }
  };

  const removeFile = async (file: SessionFile): Promise<void> => {
    if (file.status === "failed") {
      if (isTruthy(sessionId)) {
        dismissFailedSessionFile(sessionId, file.id);
      }
      closeDeleteConfirmFor(file.id);
      return;
    }

    if (!isTruthy(sessionId) || file.status !== "available") {
      return;
    }

    await removeSessionResource(toSessionId(sessionId), toFileId(file.id));
    closeDeleteConfirmFor(file.id);
    await queryClient.invalidateQueries({
      queryKey: sessionResourcesQueryKey(toSessionId(sessionId)),
    });
  };

  return (
    <aside className="border-border-subtle bg-bg-1 flex h-full w-[320px] shrink-0 flex-col border-l">
      <div className="border-border-subtle flex h-10 shrink-0 items-center gap-2 border-b bg-white px-4">
        <span className="text-fg-1 text-[12px] font-semibold">Files</span>
        <span className="text-fg-3 text-[11px]">
          {files.length} / {SESSION_FILE_LIMIT}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Add files"
          disabled={atLimit || uploadDisabled}
          onClick={triggerPicker}
          className="text-fg-3 hover:bg-ink-900/[0.06] hover:text-fg-1 inline-flex size-6 items-center justify-center rounded-md disabled:cursor-not-allowed disabled:opacity-40"
          title={uploadDisabledReason ?? undefined}
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Close files panel"
          onClick={onClose}
          className="text-fg-3 hover:bg-ink-900/[0.06] hover:text-fg-1 inline-flex size-6 items-center justify-center rounded-md"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        aria-label="Upload session files"
        disabled={uploadDisabled}
        onChange={handleFiles}
      />

      {files.length === 0 ? (
        <EmptyState
          onPick={triggerPicker}
          uploadDisabled={uploadDisabled}
          uploadDisabledReason={uploadDisabledReason}
        />
      ) : (
        <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
          {files.map((file) => (
            <FileRow key={file.id} file={file} onRemove={(entry) => void removeFile(entry)} />
          ))}
        </div>
      )}
    </aside>
  );
}
