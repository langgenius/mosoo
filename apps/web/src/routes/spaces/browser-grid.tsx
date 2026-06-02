import { FileText, Folder, Lock, Pencil, Trash2 } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";

import { isImageFile } from "../../domains/file/file-open";
import { isTruthy } from "../../shared/lib/truthiness";
import { SpaceBrowserGridDrafts } from "./browser-drafts";
import type { SpaceBrowserProps } from "./browser-types";
import { formatSize } from "./space-file-size";
export function SpaceBrowserGrid({
  canWrite,
  currentPath,
  dirs,
  files,
  newFolderError,
  newFolderName,
  onCreateFolder,
  onDeleteDirectory,
  onDeleteFile,
  onDownloadFile,
  onOpenFile,
  onOpenRenameFile,
  onSetCurrentPath,
  onSetNewFolderName,
  onSetShowNewFolder,
  showNewFolder,
}: Pick<
  SpaceBrowserProps,
  | "canWrite"
  | "currentPath"
  | "dirs"
  | "files"
  | "newFolderError"
  | "newFolderName"
  | "onCreateFolder"
  | "onDeleteDirectory"
  | "onDeleteFile"
  | "onDownloadFile"
  | "onOpenFile"
  | "onOpenRenameFile"
  | "onSetCurrentPath"
  | "onSetNewFolderName"
  | "onSetShowNewFolder"
  | "showNewFolder"
>) {
  return (
    <div className="flex flex-wrap content-start gap-3 p-4">
      <SpaceBrowserGridDrafts
        newFolderError={newFolderError}
        newFolderName={newFolderName}
        onCreateFolder={onCreateFolder}
        onSetNewFolderName={onSetNewFolderName}
        onSetShowNewFolder={onSetShowNewFolder}
        showNewFolder={showNewFolder}
      />

      {dirs.map((dir) => {
        const dirName = dir.key.replace(currentPath, "").replace(/\/$/, "");

        return (
          <ContextMenu key={dir.key}>
            <ContextMenuTrigger asChild disabled={!canWrite}>
              <button
                type="button"
                onClick={() => {
                  onSetCurrentPath(dir.key);
                }}
                className="border-border bg-card hover:border-border-strong flex h-[120px] w-[160px] cursor-pointer flex-col items-start justify-end gap-1 rounded-md border p-3 text-left transition-all"
              >
                <Folder className="text-fg-2 size-7" />
                <span className="text-fg-1 mt-1 max-w-full truncate text-[13px] font-bold">
                  {dirName}
                </span>
                <span className="text-fg-3 text-[11px]">Folder</span>
              </button>
            </ContextMenuTrigger>
            {canWrite ? (
              <ContextMenuContent>
                <ContextMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => {
                    onDeleteDirectory(dir.key);
                  }}
                >
                  <Trash2 className="mr-2 size-3.5" />
                  Delete
                </ContextMenuItem>
              </ContextMenuContent>
            ) : null}
          </ContextMenu>
        );
      })}

      {files.map((file) => {
        const fileName = file.key.replace(currentPath, "");
        const previewable = isImageFile(file.mimeType);
        const ext = (fileName.split(".").pop() ?? "").toLowerCase();
        const lockLabel = file.lock
          ? `${file.lock.holder.displayName ?? file.lock.holder.id} is editing`
          : null;
        const badgeStyle = (() => {
          if (["md", "mdx", "txt"].includes(ext)) {
            return { background: "var(--accent-soft)", color: "var(--accent-press)" };
          }
          if (["pdf"].includes(ext)) {
            return { background: "rgba(201,82,59,.14)", color: "var(--ember)" };
          }
          if (["zip", "tar", "gz", "rar", "7z"].includes(ext)) {
            return { background: "rgba(122,82,48,.14)", color: "var(--soil)" };
          }
          return { background: "var(--paper-200)", color: "var(--fg-2)" };
        })();

        return (
          <ContextMenu key={file.key}>
            <ContextMenuTrigger asChild disabled={!canWrite}>
              <button
                type="button"
                onClick={() => {
                  previewable ? onOpenFile(file.id) : onDownloadFile(file.id);
                }}
                className="border-border bg-card hover:border-border-strong flex h-[120px] w-[160px] cursor-pointer flex-col items-start justify-end gap-1 rounded-md border p-3 text-left transition-all"
              >
                <span
                  className="inline-flex size-10 items-center justify-center rounded-md font-mono text-[11px] font-bold tracking-[0.05em] uppercase"
                  style={badgeStyle}
                >
                  {ext || <FileText className="size-4" />}
                </span>
                <span className="text-fg-1 mt-1 max-w-full truncate text-[13px] font-bold">
                  {fileName}
                </span>
                {isTruthy(lockLabel) ? (
                  <span className="text-accent-press inline-flex max-w-full items-center gap-1 truncate text-[11px]">
                    <Lock className="size-3 shrink-0" />
                    <span className="truncate">{lockLabel}</span>
                  </span>
                ) : (
                  <span className="text-fg-3 font-mono text-[11px]">{formatSize(file.size)}</span>
                )}
              </button>
            </ContextMenuTrigger>
            {canWrite ? (
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={() => {
                    onDownloadFile(file.id);
                  }}
                >
                  <FileText className="mr-2 size-3.5" />
                  Download
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => {
                    onOpenRenameFile(file);
                  }}
                >
                  <Pencil className="mr-2 size-3.5" />
                  Rename / Move
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => {
                    onDeleteFile(file.id);
                  }}
                >
                  <Trash2 className="mr-2 size-3.5" />
                  Delete
                </ContextMenuItem>
              </ContextMenuContent>
            ) : null}
          </ContextMenu>
        );
      })}
    </div>
  );
}
