import type { SpaceView } from "@mosoo/contracts/space";
import { Loader2, Plus } from "lucide-react";
import type { DragEvent } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";

import { isTruthy } from "../../shared/lib/truthiness";
import { SpaceBrowser } from "./browser";
import { SpaceHeader } from "./header";
import type { useSpaceBrowser } from "./use-space-browser";
type SpaceBrowserModel = ReturnType<typeof useSpaceBrowser>;

export function SpaceFilesView({
  activeSpace,
  browser,
  canWrite,
  currentPath,
  onCurrentPathChange,
  onCreateSpace,
}: {
  activeSpace: SpaceView | undefined;
  browser: SpaceBrowserModel;
  canWrite: boolean;
  currentPath: string;
  onCurrentPathChange: (path: string) => void;
  onCreateSpace: () => void;
}) {
  const pathParts = currentPath.split("/").filter(Boolean);
  const totalItems = browser.files.length + browser.dirs.length;
  const uploadTotal = browser.uploadRows.length;
  const uploadStarted = browser.uploadRows.filter((row) => row.status !== "waiting").length;
  const uploadCurrent = Math.max(1, Math.min(uploadStarted, uploadTotal));

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();

    if (canWrite) {
      browser.setDragOver(true);
    }
  }

  function handleDragLeave() {
    browser.setDragOver(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!canWrite) {
      event.preventDefault();
      browser.setDragOver(false);
      return;
    }

    browser.handleDrop(event);
  }

  return (
    <div
      className={cn(
        "relative flex flex-1 flex-col",
        browser.dragOver && "ring-2 ring-primary ring-inset",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <SpaceHeader
        activeSpace={activeSpace}
        canWrite={canWrite}
        currentPath={currentPath}
        fileInputRef={browser.fileInputRef}
        folderInputRef={browser.folderInputRef}
        loading={browser.loading}
        onBack={() => {
          onCurrentPathChange(browser.goUp());
        }}
        onUpload={(files) => void browser.handleUpload(files)}
        onVisitPath={onCurrentPathChange}
        pathParts={pathParts}
        totalItems={totalItems}
        uploading={browser.uploading}
        viewMode={browser.viewMode}
        setViewMode={browser.setViewMode}
      />

      {!activeSpace ? (
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <div className="text-foreground text-[18px] font-semibold">Select a space</div>
          <p className="text-muted-foreground mt-2 max-w-[360px] text-sm leading-6">
            Create or select a Space, then mount it inside an Agent to put these files to work.
          </p>
          <Button className="mt-5" onClick={onCreateSpace}>
            <Plus className="size-4" />
            New Space
          </Button>
        </div>
      ) : null}

      {activeSpace ? (
        <>
          {isTruthy(browser.listingError) ? (
            <div className="border-border-soft bg-destructive/[0.06] text-destructive border-b px-5 py-2 text-[13px]">
              {browser.listingError}
            </div>
          ) : null}

          {browser.uploadSummary ? (
            <div className="border-border-soft bg-destructive/[0.06] text-destructive border-b px-5 py-2 text-[13px]">
              {browser.uploadSummary.message}
            </div>
          ) : null}

          {browser.pendingUploadConflict ? (
            <div className="border-border-soft bg-paper-100 text-fg-2 flex items-center gap-3 border-b px-5 py-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate">
                {browser.pendingUploadConflict.failedFileName} already exists.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void browser.handleResolveUploadConflict("replace")}
              >
                Replace
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void browser.handleResolveUploadConflict("keep_both")}
              >
                Keep both
              </Button>
              <Button variant="ghost" size="sm" onClick={browser.handleCancelUploadConflict}>
                Cancel
              </Button>
            </div>
          ) : null}

          {uploadTotal > 0 && browser.uploading ? (
            <div className="border-border-soft bg-background flex items-center gap-3 border-b px-5 py-2 text-[12px]">
              <Loader2 className="text-fg-3 size-3.5 shrink-0 animate-spin" />
              <span className="text-fg-2">
                Uploading {uploadCurrent} / {uploadTotal}
              </span>
              <div className="bg-paper-200 ml-auto h-1 w-32 overflow-hidden rounded-full">
                <div
                  className="bg-accent-press h-full rounded-full transition-[width] duration-150"
                  style={{ width: `${(uploadCurrent / uploadTotal) * 100}%` }}
                />
              </div>
            </div>
          ) : null}

          {uploadTotal > 0 && !browser.uploading ? (
            <div className="border-border-soft bg-background border-b px-5 py-2">
              <div className="space-y-1.5">
                {browser.uploadRows.flatMap((row) =>
                  row.status === "done"
                    ? []
                    : [
                        <div key={row.id} className="flex items-center gap-3 text-[12px]">
                          <span className="text-fg-2 min-w-0 flex-1 truncate">{row.path}</span>
                          <span
                            className={cn(
                              "w-20 text-right capitalize",
                              row.status === "failed" ? "text-destructive" : "text-fg-3",
                            )}
                            title={row.error}
                          >
                            {row.status}
                          </span>
                          {row.status === "failed" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void browser.handleRetryUpload(row.id)}
                            >
                              Retry
                            </Button>
                          ) : null}
                        </div>,
                      ],
                )}
              </div>
            </div>
          ) : null}

          {isTruthy(browser.fileActionError) ? (
            <div className="border-border-soft bg-destructive/[0.06] text-destructive border-b px-5 py-2 text-[13px]">
              {browser.fileActionError}
            </div>
          ) : null}

          {browser.dragOver ? (
            <div className="bg-accent-soft/60 pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div className="text-accent-press text-sm font-bold">Drop files to upload</div>
            </div>
          ) : null}

          <SpaceBrowser
            canWrite={canWrite}
            currentPath={currentPath}
            dirs={browser.dirs}
            fileInputRef={browser.fileInputRef}
            files={browser.files}
            folderInputRef={browser.folderInputRef}
            loading={browser.loading}
            newFolderError={browser.newFolderError}
            newFolderName={browser.newFolderName}
            onCreateFolder={() => void browser.handleCreateFolder()}
            onDeleteDirectory={(key) => void browser.handleDeleteDirectory(key)}
            onDeleteFile={(fileId) => void browser.handleDeleteFile(fileId)}
            onDownloadFile={(fileId) => void browser.handleDownloadFile(fileId)}
            onOpenFile={(fileId) => void browser.handleOpenFile(fileId)}
            onOpenRenameFile={browser.openRenameFile}
            onSetCurrentPath={onCurrentPathChange}
            onSetNewFolderName={browser.setNewFolderName}
            onSetShowNewFolder={browser.setShowNewFolder}
            showNewFolder={browser.showNewFolder}
            viewMode={browser.viewMode}
          />
        </>
      ) : null}
    </div>
  );
}
