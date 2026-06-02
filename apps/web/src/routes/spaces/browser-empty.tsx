import { Folder, FolderPlus, Upload } from "lucide-react";

import { Button } from "@/shared/ui/button";

export function SpaceBrowserEmpty({
  canWrite,
  onShowNewFolder,
  onUpload,
}: {
  canWrite: boolean;
  onShowNewFolder: () => void;
  onUpload: () => void;
}) {
  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center">
      <Folder className="text-border mb-4 size-12" strokeWidth={1} />
      <p className="text-foreground mb-1 text-2xl font-light">Empty</p>
      <p className="mb-4 text-sm">No files in this space yet</p>
      {canWrite ? (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onUpload}>
            <Upload className="size-3.5" />
            Upload
          </Button>
          <Button variant="outline" size="sm" onClick={onShowNewFolder}>
            <FolderPlus className="size-3.5" />
            New Folder
          </Button>
        </div>
      ) : null}
    </div>
  );
}
