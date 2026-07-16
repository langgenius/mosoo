import { Download } from "lucide-react";
import type { ReactElement } from "react";

import { createFileDownload } from "@/domains/file/api/file-download-client";
import type { ListedFileEntry } from "@/domains/file/api/files";
import { FilePreviewContent, formatFileSize } from "@/features/file-preview/file-preview-content";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

interface FilePreviewDialogProps {
  file: ListedFileEntry;
  onClose: () => void;
}

export function FilePreviewDialog({ file, onClose }: FilePreviewDialogProps): ReactElement {
  const download = createFileDownload(file.id);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
    >
      <DialogContent className="flex h-[82vh] max-h-[860px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]">
        <DialogHeader className="border-border-subtle shrink-0 border-b px-6 py-4 pr-14">
          <div className="flex min-w-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="truncate text-[15px]">{file.name}</DialogTitle>
              <DialogDescription className="mt-1 truncate text-[12px]">
                {formatFileSize(file.size)} · {file.mimeType ?? "Unknown format"}
              </DialogDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <a href={download.url}>
                <Download className="size-3.5" />
                Download
              </a>
            </Button>
          </div>
        </DialogHeader>
        <div className="bg-paper-50 min-h-0 flex-1 overflow-auto">
          <FilePreviewContent file={file} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
