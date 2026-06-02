import { FileText } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";

const SECTION_HEADER_STYLE = { color: "#777169" } as const;

export function SectionHeader({ children }: { children: ReactNode }): ReactElement {
  return (
    <h4
      className="mb-3 text-[11px] font-semibold tracking-wider uppercase"
      style={SECTION_HEADER_STYLE}
    >
      {children}
    </h4>
  );
}

export function RequiredMark(): ReactElement {
  return (
    <span aria-label="required" className="text-destructive ml-0.5" title="Required">
      *
    </span>
  );
}

export function MarkdownPreviewDialog({
  content,
  onOpenChange,
  open,
  title,
}: {
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
            <DialogTitle className="text-[15px] font-medium">{title}</DialogTitle>
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
