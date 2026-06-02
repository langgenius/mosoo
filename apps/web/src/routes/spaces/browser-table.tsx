import { FileText, Folder, Lock, Pencil, Trash2 } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

import { isImageFile } from "../../domains/file/file-open";
import { isTruthy } from "../../shared/lib/truthiness";
import { SpaceBrowserTableDrafts } from "./browser-drafts";
import type { SpaceBrowserProps } from "./browser-types";
import { formatSize } from "./space-file-size";
export function SpaceBrowserTable({
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
    <Table>
      <TableHeader>
        <TableRow className="border-border-subtle border-b">
          <TableHead className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
            Name
          </TableHead>
          <TableHead className="text-muted-foreground w-28 text-[11px] font-medium tracking-wider uppercase">
            Size
          </TableHead>
          <TableHead className="text-muted-foreground w-36 text-[11px] font-medium tracking-wider uppercase">
            Modified
          </TableHead>
          <TableHead className="text-muted-foreground w-24 text-[11px] font-medium tracking-wider uppercase">
            Type
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <SpaceBrowserTableDrafts
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
                <TableRow
                  onClick={() => {
                    onSetCurrentPath(dir.key);
                  }}
                  className="border-border-subtle/50 hover:bg-accent/50 cursor-pointer border-b"
                >
                  <TableCell className="flex items-center gap-2 text-sm">
                    <Folder className="text-primary size-4" />
                    {dirName}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">--</TableCell>
                  <TableCell className="text-muted-foreground text-xs">--</TableCell>
                  <TableCell className="text-muted-foreground text-xs">Folder</TableCell>
                </TableRow>
              </ContextMenuTrigger>
              {canWrite ? (
                <ContextMenuContent>
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => {
                      onDeleteDirectory(dir.key);
                    }}
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              ) : null}
            </ContextMenu>
          );
        })}

        {files.map((file) => {
          const fileName = file.key.replace(currentPath, "");
          const ext = fileName.split(".").pop()?.toUpperCase() ?? "--";
          const previewable = isImageFile(file.mimeType);
          const lockLabel = file.lock
            ? `${file.lock.holder.displayName ?? file.lock.holder.id} is editing`
            : null;

          return (
            <ContextMenu key={file.key}>
              <ContextMenuTrigger asChild disabled={!canWrite}>
                <TableRow
                  onClick={() => {
                    previewable ? onOpenFile(file.id) : onDownloadFile(file.id);
                  }}
                  className="border-border-subtle/50 hover:bg-accent/50 cursor-pointer border-b"
                >
                  <TableCell className="flex items-center gap-2 text-sm">
                    <FileText className="text-muted-foreground size-4" />
                    <span className="min-w-0 truncate">{fileName}</span>
                    {isTruthy(lockLabel) ? (
                      <span className="bg-accent-soft text-accent-press inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px]">
                        <Lock className="size-3" />
                        {lockLabel}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatSize(file.size)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs" suppressHydrationWarning>
                    {new Date(file.uploadedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{ext}</TableCell>
                </TableRow>
              </ContextMenuTrigger>
              {canWrite ? (
                <ContextMenuContent>
                  <ContextMenuItem
                    onSelect={() => {
                      onDownloadFile(file.id);
                    }}
                  >
                    <FileText className="size-4" />
                    Download
                  </ContextMenuItem>
                  <ContextMenuItem
                    onSelect={() => {
                      onOpenRenameFile(file);
                    }}
                  >
                    <Pencil className="size-4" />
                    Rename / Move
                  </ContextMenuItem>
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => {
                      onDeleteFile(file.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              ) : null}
            </ContextMenu>
          );
        })}
      </TableBody>
    </Table>
  );
}
