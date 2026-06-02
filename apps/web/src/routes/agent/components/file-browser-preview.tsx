import { Download, Loader2, RefreshCw, X } from "lucide-react";
import { lazy, Suspense } from "react";
import type { ReactElement } from "react";

import { getAgentFileDownloadUrl } from "@/domains/agent/api/agent-file-browser-client";
import type { AgentFileContent } from "@/domains/agent/api/agent-file-browser-client";
import { toAgentId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";

import { formatBytes } from "./file-browser-model";

const LARGE_FILE_WARNING_BYTES = 100 * 1024 * 1024;

function getFileLanguage(path: string): string {
  const fileName = path.split("/").at(-1)?.toLowerCase() ?? "";
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1) : "";

  switch (extension) {
    case "bash":
    case "fish":
    case "sh":
    case "zsh": {
      return "shell";
    }
    case "cjs":
    case "js":
    case "mjs": {
      return "javascript";
    }
    case "css":
    case "go":
    case "html":
    case "java":
    case "json":
    case "lua":
    case "py":
    case "rb":
    case "rs":
    case "scss":
    case "sql":
    case "toml":
    case "ts":
    case "xml":
      return extension;
    case "jsx": {
      return "javascript";
    }
    case "markdown":
    case "md": {
      return "markdown";
    }
    case "tsx": {
      return "typescript";
    }
    case "yaml":
    case "yml": {
      return "yaml";
    }
    default: {
      return "plaintext";
    }
  }
}

const MonacoEditor = lazy(async () => {
  const monaco = await import("@monaco-editor/react");
  return { default: monaco.default };
});

function PreviewPlaceholder({
  content,
  onDownload,
}: {
  content: AgentFileContent;
  onDownload: () => void;
}): ReactElement {
  const isEmpty = content.preview === "empty";
  const isLargeText = content.preview === "large_text";
  const isLargeDownload = content.sizeBytes > LARGE_FILE_WARNING_BYTES;

  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="border-border-subtle w-full max-w-md rounded-md border bg-white p-5">
        <div className="text-fg-1 truncate text-[14px] font-semibold">{content.name}</div>
        <div className="text-muted-foreground mt-1 font-mono text-[12px]">{content.path}</div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
          <div>
            <div className="text-muted-foreground">Size</div>
            <div className="text-fg-1 mt-0.5 font-medium">{formatBytes(content.sizeBytes)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">MIME</div>
            <div className="text-fg-1 mt-0.5 truncate font-medium">{content.mimeType}</div>
          </div>
        </div>
        <div className="text-muted-foreground mt-4 text-[12px]">
          {isEmpty
            ? "Empty file"
            : isLargeDownload
              ? `Large file (${formatBytes(content.sizeBytes)}) · Download may take a while`
              : isLargeText
                ? `Open in Terminal: less ${content.path}`
                : "Preview unavailable"}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isEmpty}
          onClick={onDownload}
          className="mt-4"
        >
          <Download aria-hidden="true" className="size-4" />
          {isLargeDownload ? "Download large file" : "Download"}
        </Button>
      </div>
    </div>
  );
}

export function FilePreview({
  agentId,
  content,
  contentError,
  contentLoading,
  onClose,
  onRetry,
  selectedPath,
}: {
  agentId: string;
  content: AgentFileContent | null;
  contentError: Error | null;
  contentLoading: boolean;
  onClose: () => void;
  onRetry: () => void;
  selectedPath: string | null;
}): ReactElement {
  function download(path: string): void {
    globalThis.location.assign(getAgentFileDownloadUrl({ agentId: toAgentId(agentId), path }));
  }

  if (selectedPath === null) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-[13px]">
        Select a file
      </div>
    );
  }

  if (contentLoading) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-[13px]">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Loading file…
      </div>
    );
  }

  if (contentError !== null) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="border-border-subtle rounded-md border bg-white p-5 text-center">
          <div className="text-[13px] font-medium text-red-700">Failed to load file.</div>
          <div className="text-muted-foreground mt-1 max-w-sm text-[12px]">
            {contentError.message}
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onRetry} className="mt-4">
            <RefreshCw aria-hidden="true" className="size-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (content === null) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-[13px]">
        File not loaded
      </div>
    );
  }

  const canDownload = content.preview !== "empty";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border-subtle flex h-12 shrink-0 items-center justify-between gap-3 border-b bg-white px-4">
        <div className="min-w-0">
          <div className="text-fg-1 truncate text-[13px] font-medium">{content.name}</div>
          <div className="text-muted-foreground truncate font-mono text-[11px]">{content.path}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canDownload}
            onClick={() => {
              download(content.path);
            }}
          >
            <Download aria-hidden="true" className="size-4" />
            Download
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-white">
        {content.preview === "text" && content.content !== null ? (
          <Suspense
            fallback={
              <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-[13px]">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                Loading editor…
              </div>
            }
          >
            <MonacoEditor
              height="100%"
              language={getFileLanguage(content.path)}
              options={{
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
                fontSize: 12,
                lineNumbers: "on",
                minimap: { enabled: false },
                readOnly: true,
                renderLineHighlight: "line",
                scrollBeyondLastLine: false,
                wordWrap: "off",
              }}
              path={content.path}
              theme="vs"
              value={content.content}
            />
          </Suspense>
        ) : (
          <PreviewPlaceholder
            content={content}
            onDownload={() => {
              download(content.path);
            }}
          />
        )}
      </div>
    </div>
  );
}
