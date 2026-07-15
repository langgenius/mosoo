import { FileText } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

export function MarkdownPreviewDialog({
  badge = null,
  content,
  onOpenChange,
  open,
  title,
}: {
  badge?: ReactNode;
  content: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}): ReactElement {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[80vh] gap-0 overflow-hidden rounded-lg p-0 sm:max-w-[640px]">
        <DialogHeader className="border-border-subtle border-b px-6 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <FileText className="text-muted-foreground size-4" />
            <DialogTitle className="min-w-0 truncate text-[15px] font-medium">{title}</DialogTitle>
            {badge}
          </div>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          <pre className="text-foreground text-[13px] leading-relaxed whitespace-pre-wrap">
            {content}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
