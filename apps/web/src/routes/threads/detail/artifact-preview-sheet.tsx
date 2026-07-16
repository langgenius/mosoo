import { Download } from "lucide-react";
import type { ReactElement } from "react";

import { createFileDownload } from "@/domains/file/api/file-download-client";
import type { ListedFileEntry } from "@/domains/file/api/files";
import { FilePreviewContent, formatFileSize } from "@/features/file-preview/file-preview-content";
import { Button } from "@/shared/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/shared/ui/sheet";

export function ArtifactPreviewSheet({
  file,
  onClose,
}: {
  file: ListedFileEntry;
  onClose: () => void;
}): ReactElement {
  const download = createFileDownload(file.id);

  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
    >
      <SheetContent className="w-[min(760px,calc(100vw-1rem))] max-w-none overflow-hidden">
        <header className="border-border-subtle flex min-w-0 shrink-0 items-start justify-between gap-4 border-b px-5 py-4 pr-14">
          <div className="min-w-0">
            <SheetTitle className="truncate text-[15px]">{file.name}</SheetTitle>
            <p className="text-fg-3 mt-1 truncate text-[12px]">
              {formatFileSize(file.size)} · {file.mimeType ?? "Unknown format"}
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <a href={download.url}>
              <Download className="size-3.5" />
              Download
            </a>
          </Button>
        </header>
        <div className="bg-paper-50 min-h-0 flex-1 overflow-auto">
          <FilePreviewContent file={file} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
