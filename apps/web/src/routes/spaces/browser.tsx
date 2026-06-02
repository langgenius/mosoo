import { Folder, FolderPlus, Upload } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import { ScrollArea } from "@/shared/ui/scroll-area";

import { SpaceBrowserEmpty } from "./browser-empty";
import { SpaceBrowserGrid } from "./browser-grid";
import { SpaceBrowserTable } from "./browser-table";
import type { SpaceBrowserProps } from "./browser-types";

export function SpaceBrowser({
  canWrite,
  currentPath,
  dirs,
  fileInputRef,
  files,
  folderInputRef,
  loading,
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
  viewMode,
}: SpaceBrowserProps) {
  const hasEntries = dirs.length > 0 || files.length > 0;
  const showEmptyState = !hasEntries && !showNewFolder;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={!canWrite}>
        <ScrollArea className="flex-1 [&>[data-slot=scroll-area-viewport]>div]:block! [&>[data-slot=scroll-area-viewport]>div]:h-full">
          {loading ? (
            <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
              Loading…
            </div>
          ) : showEmptyState ? (
            <SpaceBrowserEmpty
              canWrite={canWrite}
              onShowNewFolder={() => {
                onSetShowNewFolder(true);
              }}
              onUpload={() => fileInputRef.current?.click()}
            />
          ) : viewMode === "grid" ? (
            <SpaceBrowserGrid
              canWrite={canWrite}
              currentPath={currentPath}
              dirs={dirs}
              files={files}
              newFolderError={newFolderError}
              newFolderName={newFolderName}
              onCreateFolder={onCreateFolder}
              onDeleteDirectory={onDeleteDirectory}
              onDeleteFile={onDeleteFile}
              onDownloadFile={onDownloadFile}
              onOpenFile={onOpenFile}
              onOpenRenameFile={onOpenRenameFile}
              onSetCurrentPath={onSetCurrentPath}
              onSetNewFolderName={onSetNewFolderName}
              onSetShowNewFolder={onSetShowNewFolder}
              showNewFolder={showNewFolder}
            />
          ) : (
            <SpaceBrowserTable
              canWrite={canWrite}
              currentPath={currentPath}
              dirs={dirs}
              files={files}
              newFolderError={newFolderError}
              newFolderName={newFolderName}
              onCreateFolder={onCreateFolder}
              onDeleteDirectory={onDeleteDirectory}
              onDeleteFile={onDeleteFile}
              onDownloadFile={onDownloadFile}
              onOpenFile={onOpenFile}
              onOpenRenameFile={onOpenRenameFile}
              onSetCurrentPath={onSetCurrentPath}
              onSetNewFolderName={onSetNewFolderName}
              onSetShowNewFolder={onSetShowNewFolder}
              showNewFolder={showNewFolder}
            />
          )}
        </ScrollArea>
      </ContextMenuTrigger>

      {canWrite ? (
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => {
              onSetShowNewFolder(true);
            }}
          >
            <FolderPlus className="size-4" />
            New Folder
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => fileInputRef.current?.click()}>
            <Upload className="size-4" />
            Upload Files
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => folderInputRef.current?.click()}>
            <Folder className="size-4" />
            Upload Folder
          </ContextMenuItem>
        </ContextMenuContent>
      ) : null}
    </ContextMenu>
  );
}
