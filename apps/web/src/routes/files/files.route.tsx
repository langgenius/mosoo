import type { FileEntry, FileListQuery, FileSessionKind } from "@mosoo/contracts/file";
import { useQuery } from "@tanstack/react-query";
import { Download, FileStack, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { useMemo, useState } from "react";

import { useAppSession } from "@/app/session-provider";
import { createFileDownload } from "@/domains/file/api/file-download-client";
import { fileKeys, listFiles } from "@/domains/file/api/files";
import { threadSessions } from "@/domains/session/api/list";
import { toAppId, toSessionId } from "@/routes/typed-id";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { Input } from "@/shared/ui/input";
import {
  ListPageContent,
  ListPageSearch,
  ListPageToolbar,
  ListPageToolbarSpacer,
} from "@/shared/ui/list-page";
import { PageHeader } from "@/shared/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

type SessionKindFilter = "all" | FileSessionKind;

const SESSION_KIND_OPTIONS: { label: string; value: SessionKindFilter }[] = [
  { label: "All", value: "all" },
  { label: "Attachments", value: "attachment" },
  { label: "Artifacts", value: "artifact" },
];

function SegmentedButtonGroup<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: T) => void;
  options: { label: string; value: T }[];
  value: T;
}): ReactElement {
  return (
    <fieldset
      aria-label={label}
      className="bg-card border-border-strong m-0 inline-flex h-8 min-w-0 overflow-hidden rounded-md border p-0"
    >
      {options.map((option) => (
        <button
          key={option.value}
          aria-pressed={option.value === value}
          className={cn(
            "border-border-strong min-w-24 border-r px-3 text-[12.5px] font-semibold transition-colors last:border-r-0",
            option.value === value
              ? "bg-paper-200 text-fg-1"
              : "text-fg-2 hover:bg-paper-200/60 hover:text-fg-1",
          )}
          onClick={() => {
            onChange(option.value);
          }}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}

function createFilesQueryInput(
  appId: string,
  sessionId: string,
  sessionKind: SessionKindFilter,
): FileListQuery {
  const input: FileListQuery =
    sessionKind === "all"
      ? {
          appId: toAppId(appId),
        }
      : {
          appId: toAppId(appId),
          sessionKind,
        };

  if (!sessionId) {
    return input;
  }

  return {
    ...input,
    sessionId: toSessionId(sessionId),
  };
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

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function formatFileCategory(file: FileEntry): string {
  if (file.sessionKind === "artifact") {
    return "Artifact";
  }

  if (file.sessionKind === null) {
    return "File";
  }

  return "Attachment";
}

function fileCategoryVariant(file: FileEntry): "default" | "soil" {
  return file.sessionKind === "artifact" ? "soil" : "default";
}

function matchesSearch(file: FileEntry, search: string): boolean {
  const normalized = search.trim().toLowerCase();

  if (!normalized) {
    return true;
  }

  return [file.name, file.path, file.id, file.mimeType ?? ""].some((value) =>
    value.toLowerCase().includes(normalized),
  );
}

function FileTable({ files }: { files: FileEntry[] }): ReactElement {
  return (
    <div className="bg-card border-border-strong overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="bg-paper-100 hover:bg-paper-100">
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            <TableHead className="hidden text-right md:table-cell">Size</TableHead>
            <TableHead className="hidden lg:table-cell">Updated</TableHead>
            <TableHead className="w-10 text-right"> </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((file) => {
            const download = createFileDownload(file.id);

            return (
              <TableRow key={file.id}>
                <TableCell className="min-w-[220px]">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-fg-1 max-w-[360px] truncate text-[13px] font-semibold">
                      {file.name}
                    </span>
                    <span className="text-fg-3 max-w-[420px] truncate text-[12px]">
                      {file.path}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant={fileCategoryVariant(file)}>{formatFileCategory(file)}</Badge>
                </TableCell>
                <TableCell className="text-fg-2 hidden text-right text-[12px] tabular-nums md:table-cell">
                  {formatBytes(file.size)}
                </TableCell>
                <TableCell className="text-fg-3 hidden text-[12px] lg:table-cell">
                  {formatDateTime(file.updatedAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild size="icon-xs" variant="ghost">
                    <a aria-label={`Download ${file.name}`} href={download.url}>
                      <Download className="size-3.5" />
                    </a>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function FilesPage(): ReactElement {
  const { activeAppId } = useAppSession();
  const [sessionId, setSessionId] = useState("");
  const [sessionKind, setSessionKind] = useState<SessionKindFilter>("all");
  const [search, setSearch] = useState("");
  const normalizedSessionId = sessionId.trim();
  const sessionOptionsQuery = useQuery({
    enabled: activeAppId !== null,
    queryFn: async () => {
      if (activeAppId === null) {
        throw new Error("App id is required to list sessions.");
      }

      return threadSessions(toAppId(activeAppId), "ui");
    },
    queryKey: [...fileKeys.all, "session-options", activeAppId],
  });
  const filesQuery = useQuery({
    enabled: activeAppId !== null,
    queryFn: async () => {
      if (activeAppId === null) {
        throw new Error("App id is required to list files.");
      }

      return listFiles(createFilesQueryInput(activeAppId, normalizedSessionId, sessionKind));
    },
    queryKey: [...fileKeys.lists(), activeAppId, normalizedSessionId, sessionKind],
  });
  const files = filesQuery.data?.files ?? [];
  const filteredFiles = useMemo(
    () => files.filter((file) => matchesSearch(file, search)),
    [files, search],
  );

  return (
    <div className="bg-background flex h-full flex-1 flex-col overflow-hidden">
      <PageHeader title="Files" description="App files, Thread attachments, and runtime artifacts.">
        <Button
          disabled={filesQuery.isFetching}
          onClick={() => {
            void filesQuery.refetch();
          }}
          size="sm"
          variant="outline"
        >
          <RefreshCw className={cn("size-3.5", filesQuery.isFetching && "animate-spin")} />
          Refresh
        </Button>
      </PageHeader>

      <ListPageToolbar className="flex-wrap">
        <select
          aria-label="Thread filter"
          className="bg-card border-border-strong text-fg-2 focus:border-ring h-8 min-w-[220px] rounded-md border px-2 text-[12.5px] transition-colors outline-none"
          disabled={sessionOptionsQuery.isLoading || sessionOptionsQuery.error !== null}
          onChange={(event) => {
            setSessionId(event.target.value);
          }}
          value={
            sessionOptionsQuery.data?.some((entry) => entry.session.id === sessionId)
              ? sessionId
              : ""
          }
        >
          <option value="">All files</option>
          {(sessionOptionsQuery.data ?? []).map((entry) => (
            <option key={entry.session.id} value={entry.session.id}>
              {entry.session.title ?? entry.session.id}
            </option>
          ))}
        </select>
        <Input
          aria-label="Thread ID"
          className="h-8 w-[280px] text-[12.5px]"
          onChange={(event) => {
            setSessionId(event.target.value);
          }}
          placeholder="Filter by Thread ID"
          value={sessionId}
        />
        <SegmentedButtonGroup<SessionKindFilter>
          label="Thread file category"
          onChange={setSessionKind}
          options={SESSION_KIND_OPTIONS}
          value={sessionKind}
        />
        <ListPageToolbarSpacer />
        <ListPageSearch
          className="w-[280px]"
          onChange={setSearch}
          placeholder="Search files..."
          value={search}
        />
      </ListPageToolbar>

      <ListPageContent className="space-y-3">
        {filesQuery.error ? (
          <div className="text-destructive border-destructive/20 bg-destructive/[0.06] rounded-md border px-3 py-2 text-[13px]">
            {filesQuery.error instanceof Error ? filesQuery.error.message : "Failed to load files."}
          </div>
        ) : filesQuery.isLoading ? (
          <div className="text-fg-3 py-12 text-center text-[13px]">Loading files...</div>
        ) : filteredFiles.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title={search.trim() ? "No matching files" : "No files"}
            description="App files, Thread attachments, and runtime artifacts will appear here."
          />
        ) : (
          <FileTable files={filteredFiles} />
        )}
      </ListPageContent>
    </div>
  );
}
