import { useQuery } from "@tanstack/react-query";
import { Download, FileStack, RefreshCw } from "lucide-react";
import type { ReactElement } from "react";
import { useMemo, useState } from "react";

import { useAppSession } from "@/app/session-provider";
import { useVisibleAgentsQuery } from "@/domains/agent/query/agent-queries";
import { createFileDownload } from "@/domains/file/api/file-download-client";
import { fileKeys, listFiles } from "@/domains/file/api/files";
import type { ListedFileEntry } from "@/domains/file/api/files";
import { allThreadSessions } from "@/domains/session/api/list";
import { toAppId } from "@/routes/typed-id";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import {
  ListPageContent,
  ListPageSearch,
  ListPageToolbar,
  ListPageToolbarSpacer,
} from "@/shared/ui/list-page";
import { PageHeader } from "@/shared/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

import { FilePreviewDialog } from "./file-preview-dialog";
import { createFilesViewModel } from "./files-list-model";
import type { FilesTableEntry, SessionKindFilter } from "./files-list-model";

const SESSION_KIND_OPTIONS: { label: string; value: SessionKindFilter }[] = [
  { label: "All", value: "all" },
  { label: "Attachments", value: "attachment" },
  { label: "Artifacts", value: "artifact" },
];
const EMPTY_FILES: ListedFileEntry[] = [];
const FILE_UPDATED_AT_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  year: "numeric",
});

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
  return FILE_UPDATED_AT_FORMATTER.format(new Date(value));
}

function formatFileCategory(file: ListedFileEntry): string {
  if (file.sessionKind === "artifact") {
    return "Artifact";
  }

  if (file.sessionKind === null) {
    return "File";
  }

  return "Attachment";
}

function fileCategoryVariant(file: ListedFileEntry): "default" | "soil" {
  return file.sessionKind === "artifact" ? "soil" : "default";
}

function FileTable({
  files,
  onPreview,
}: {
  files: FilesTableEntry[];
  onPreview: (file: ListedFileEntry) => void;
}): ReactElement {
  return (
    <div className="bg-card border-border-strong overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="bg-paper-100 hover:bg-paper-100">
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            <TableHead className="hidden lg:table-cell">Agent</TableHead>
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
                  <button
                    aria-label={`Preview ${file.name}`}
                    className="flex max-w-full min-w-0 cursor-pointer flex-col gap-1 text-left"
                    onClick={() => {
                      onPreview(file);
                    }}
                    type="button"
                  >
                    <span className="text-fg-1 max-w-[360px] truncate text-[13px] font-semibold">
                      {file.name}
                    </span>
                    <span className="text-fg-3 max-w-[420px] truncate text-[12px]">
                      {file.path}
                    </span>
                  </button>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant={fileCategoryVariant(file)}>{formatFileCategory(file)}</Badge>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {file.agent === null ? (
                    <span className="text-fg-3 text-[12px]">—</span>
                  ) : (
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-fg-1 max-w-[180px] truncate text-[12px] font-medium">
                        {file.agent.name}
                      </span>
                      <span className="text-fg-3 text-[11px]">
                        {file.agent.relation === "created" ? "Created" : "Reads"}
                      </span>
                    </div>
                  )}
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
  const [agentId, setAgentId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionKind, setSessionKind] = useState<SessionKindFilter>("all");
  const [search, setSearch] = useState("");
  const [previewFile, setPreviewFile] = useState<ListedFileEntry | null>(null);
  const {
    data: agents = [],
    isFetching: agentsFetching,
    refetch: refetchAgents,
  } = useVisibleAgentsQuery(activeAppId);
  const {
    data: sessionOptions = [],
    error: sessionOptionsError,
    isFetching: sessionOptionsFetching,
    isLoading: sessionOptionsLoading,
    refetch: refetchSessionOptions,
  } = useQuery({
    enabled: activeAppId !== null,
    queryFn: async () => {
      if (activeAppId === null) {
        throw new Error("App id is required to list sessions.");
      }

      return allThreadSessions(toAppId(activeAppId));
    },
    queryKey: [...fileKeys.all, "session-options", activeAppId],
  });
  const {
    data: fileList,
    error: filesError,
    isFetching: filesFetching,
    isLoading: filesLoading,
    refetch: refetchFiles,
  } = useQuery({
    enabled: activeAppId !== null,
    queryFn: async () => {
      if (activeAppId === null) {
        throw new Error("App id is required to list files.");
      }

      return listFiles({ appId: toAppId(activeAppId) });
    },
    queryKey:
      activeAppId === null
        ? [...fileKeys.lists(), "missing"]
        : fileKeys.list({ appId: toAppId(activeAppId) }),
  });
  const files = fileList?.files ?? EMPTY_FILES;
  const filesView = useMemo(
    () =>
      createFilesViewModel(
        files,
        sessionOptions.map((entry) => ({
          agentId: entry.session.agentId,
          id: entry.session.id,
          title: entry.session.title,
        })),
        agents.map((agent) => ({ id: agent.id, name: agent.name })),
        { agentId, search, sessionId, sessionKind },
      ),
    [agentId, agents, files, search, sessionId, sessionKind, sessionOptions],
  );
  const filtersActive =
    filesView.agentId !== "" ||
    filesView.sessionId !== "" ||
    sessionKind !== "all" ||
    search.trim() !== "";
  const refreshing = filesFetching || sessionOptionsFetching || agentsFetching;

  return (
    <div className="bg-background flex h-full flex-1 flex-col overflow-hidden">
      <PageHeader title="Files" description="App files, Thread attachments, and runtime artifacts.">
        <Button
          disabled={refreshing}
          onClick={() => {
            void Promise.all([refetchFiles(), refetchSessionOptions(), refetchAgents()]);
          }}
          size="sm"
          variant="outline"
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </PageHeader>

      <ListPageToolbar className="flex-wrap">
        <select
          aria-label="Agent filter"
          className="bg-card border-border-strong text-fg-2 focus:border-ring h-8 min-w-[220px] rounded-md border px-2 text-[12.5px] transition-colors outline-none"
          disabled={sessionOptionsLoading || sessionOptionsError !== null}
          onChange={(event) => {
            setAgentId(event.target.value);
            setSessionId("");
          }}
          value={filesView.agentId}
        >
          <option value="">All agents</option>
          {filesView.agentOptions.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Thread filter"
          className="bg-card border-border-strong text-fg-2 focus:border-ring h-8 min-w-[300px] rounded-md border px-2 text-[12.5px] transition-colors outline-none"
          disabled={sessionOptionsLoading || sessionOptionsError !== null}
          onChange={(event) => {
            setSessionId(event.target.value);
          }}
          value={filesView.sessionId}
        >
          <option value="">All Threads</option>
          {filesView.sessionOptions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.title === null ? session.id : `${session.title} — ${session.id}`}
            </option>
          ))}
        </select>
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
        {filesError ? (
          <div className="text-destructive border-destructive/20 bg-destructive/[0.06] rounded-md border px-3 py-2 text-[13px]">
            {filesError instanceof Error ? filesError.message : "Failed to load files."}
          </div>
        ) : filesLoading ? (
          <div className="text-fg-3 py-12 text-center text-[13px]">Loading files...</div>
        ) : filesView.files.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title={filtersActive ? "No matching files" : "No files"}
            description="App files, Thread attachments, and runtime artifacts will appear here."
          />
        ) : (
          <FileTable files={filesView.files} onPreview={setPreviewFile} />
        )}
      </ListPageContent>
      {previewFile === null ? null : (
        <FilePreviewDialog
          key={previewFile.id}
          file={previewFile}
          onClose={() => {
            setPreviewFile(null);
          }}
        />
      )}
    </div>
  );
}
