import type { SpaceView } from "@mosoo/contracts/space";
import { ChevronLeft, FolderUp, LayoutGrid, List, Upload } from "lucide-react";
import type React from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";

export function SpaceHeader({
  activeSpace,
  canWrite,
  currentPath,
  fileInputRef,
  folderInputRef,
  loading,
  onBack,
  onUpload,
  onVisitPath,
  pathParts,
  totalItems,
  uploading,
  viewMode,
  setViewMode,
}: {
  activeSpace: SpaceView | undefined;
  canWrite: boolean;
  currentPath: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  folderInputRef: React.RefObject<HTMLInputElement | null>;
  loading: boolean;
  onBack: () => void;
  onUpload: (files: FileList | null) => void;
  onVisitPath: (path: string) => void;
  pathParts: string[];
  totalItems: number;
  uploading: boolean;
  viewMode: "list" | "grid";
  setViewMode: (mode: "list" | "grid") => void;
}) {
  const titleText = activeSpace?.name ?? "Select a space";

  return (
    <header className="border-border-soft border-b px-6 pt-5 pb-4">
      <div className="mb-1 flex items-center gap-2">
        {currentPath ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onBack}
            className="text-fg-3"
            aria-label="Go up"
          >
            <ChevronLeft className="size-3.5" />
          </Button>
        ) : null}

        <h2 className="text-fg-1 text-[24px] font-semibold tracking-[-0.02em]">{titleText}</h2>

        {pathParts.map((part, index) => {
          const segmentPath = `${pathParts.slice(0, index + 1).join("/")}/`;

          return (
            <span
              key={segmentPath}
              className="text-fg-3 flex items-center gap-1.5 text-[24px] font-semibold tracking-[-0.02em]"
            >
              <span>/</span>
              <button
                type="button"
                onClick={() => {
                  onVisitPath(segmentPath);
                }}
                className="hover:text-fg-1 transition-colors"
              >
                {part}
              </button>
            </span>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          {canWrite ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                aria-label="Upload files to space"
                className="hidden"
                onChange={(event) => {
                  onUpload(event.target.files);
                }}
              />
              <input
                ref={folderInputRef}
                type="file"
                // @ts-expect-error webkitdirectory is not in HTMLInputElement types
                webkitdirectory=""
                multiple
                aria-label="Upload folder to space"
                className="hidden"
                onChange={(event) => {
                  onUpload(event.target.files);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="size-3.5" />
                {uploading ? "Uploading…" : "Upload"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => folderInputRef.current?.click()}
                disabled={uploading}
              >
                <FolderUp className="size-3.5" />
                Folder
              </Button>
            </>
          ) : null}

          <div className="border-border-strong bg-card flex items-center overflow-hidden rounded-md border">
            <button
              type="button"
              onClick={() => {
                setViewMode("list");
              }}
              className={cn(
                "size-8 flex items-center justify-center transition-colors",
                viewMode === "list" ? "bg-paper-200 text-fg-1" : "text-fg-3 hover:bg-paper-200/50",
              )}
              title="List view"
            >
              <List className="size-3.5" />
            </button>
            <span className="bg-border-strong h-5 w-px" />
            <button
              type="button"
              onClick={() => {
                setViewMode("grid");
              }}
              className={cn(
                "size-8 flex items-center justify-center transition-colors",
                viewMode === "grid" ? "bg-paper-200 text-fg-1" : "text-fg-3 hover:bg-paper-200/50",
              )}
              title="Grid view"
            >
              <LayoutGrid className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {!loading ? (
        <p className="text-fg-3 ml-1 text-[12.5px]">
          {totalItems} {totalItems === 1 ? "item" : "items"}
        </p>
      ) : null}
    </header>
  );
}
