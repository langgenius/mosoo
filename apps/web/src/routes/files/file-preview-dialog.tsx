import { useQuery } from "@tanstack/react-query";
import { Download, FileQuestion, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";

import { createFileDownload, readFileText } from "@/domains/file/api/file-download-client";
import { fileKeys } from "@/domains/file/api/files";
import type { ListedFileEntry } from "@/domains/file/api/files";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { StaticMarkdown } from "@/shared/ui/static-markdown";

import {
  getFilePreviewKind,
  getTableDelimiter,
  MAX_TEXT_PREVIEW_BYTES,
  parseDelimitedText,
} from "./file-preview";
import type { FilePreviewKind } from "./file-preview";

interface FilePreviewDialogProps {
  file: ListedFileEntry;
  onClose: () => void;
}

interface TextPreviewProps {
  content: string;
  file: ListedFileEntry;
  kind: "markdown" | "table" | "text";
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unitIndex]}`;
}

function TextPreview({ content, file, kind }: TextPreviewProps): ReactElement {
  if (kind === "markdown") {
    return <StaticMarkdown className="mx-auto max-w-4xl px-6 py-5">{content}</StaticMarkdown>;
  }

  if (kind === "table") {
    const table = parseDelimitedText(content, getTableDelimiter(file.name, file.mimeType));
    const [header = [], ...body] = table.rows;

    if (header.length === 0) {
      return (
        <div className="text-fg-3 px-6 py-12 text-center text-[13px]">This table is empty.</div>
      );
    }

    return (
      <div className="p-5">
        <div className="border-border-strong overflow-auto rounded-md border">
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead className="bg-paper-100 sticky top-0">
              <tr>
                {header.map((cell, index) => (
                  <th
                    key={`${index}-${cell}`}
                    className="border-border min-w-32 border-r border-b px-3 py-2 font-semibold last:border-r-0"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-border border-b last:border-b-0">
                  {header.map((_, columnIndex) => (
                    <td
                      key={columnIndex}
                      className="border-border max-w-80 border-r px-3 py-2 align-top whitespace-pre-wrap last:border-r-0"
                    >
                      {row[columnIndex] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {table.truncated ? (
          <p className="text-fg-3 mt-3 text-[12px]">
            Preview limited to the first 200 rows and 50 columns.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <pre className="text-fg-1 m-0 min-h-full overflow-auto p-5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap">
      {content}
    </pre>
  );
}

function PreviewUnavailable({
  file,
  message,
}: {
  file: ListedFileEntry;
  message: string;
}): ReactElement {
  const download = createFileDownload(file.id);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <FileQuestion className="text-fg-3 size-8" />
      <p className="text-fg-2 max-w-md text-[13px]">{message}</p>
      <Button asChild size="sm" variant="outline">
        <a href={download.url}>
          <Download className="size-3.5" />
          Download file
        </a>
      </Button>
    </div>
  );
}

function FilePreviewContent({
  file,
  kind,
}: {
  file: ListedFileEntry;
  kind: FilePreviewKind;
}): ReactElement {
  const inlineDownload = createFileDownload(file.id, "inline");
  const needsText = kind === "markdown" || kind === "table" || kind === "text";
  const canLoadText = needsText && file.size <= MAX_TEXT_PREVIEW_BYTES;
  const { data, error, isLoading } = useQuery({
    enabled: canLoadText,
    queryFn: ({ signal }) => readFileText(file.id, signal),
    queryKey: [...fileKeys.all, "preview", file.id, file.etag ?? file.version],
  });

  if (kind === "image") {
    return (
      <div className="flex h-full items-center justify-center p-5">
        <img
          alt={file.name}
          className="max-h-full max-w-full rounded-sm object-contain"
          src={inlineDownload.url}
        />
      </div>
    );
  }

  if (kind === "pdf") {
    return (
      <object
        aria-label={file.name}
        className="h-full w-full bg-white"
        data={inlineDownload.url}
        type="application/pdf"
      >
        <PreviewUnavailable file={file} message="This browser cannot display the PDF preview." />
      </object>
    );
  }

  if (kind === "unsupported") {
    return (
      <PreviewUnavailable
        file={file}
        message="This file format does not support in-page preview."
      />
    );
  }

  if (!canLoadText) {
    return (
      <PreviewUnavailable
        file={file}
        message={`Text preview is limited to ${formatBytes(MAX_TEXT_PREVIEW_BYTES)} files.`}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="text-fg-3 flex h-full items-center justify-center gap-2 text-[13px]">
        <LoaderCircle className="size-4 animate-spin" />
        Loading preview...
      </div>
    );
  }

  if (error !== null) {
    return (
      <PreviewUnavailable
        file={file}
        message={error instanceof Error ? error.message : "Failed to load file preview."}
      />
    );
  }

  return <TextPreview content={data ?? ""} file={file} kind={kind} />;
}

export function FilePreviewDialog({ file, onClose }: FilePreviewDialogProps): ReactElement {
  const kind = getFilePreviewKind(file.name, file.mimeType);
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
                {formatBytes(file.size)} · {file.mimeType ?? "Unknown format"}
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
          <FilePreviewContent file={file} kind={kind} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
