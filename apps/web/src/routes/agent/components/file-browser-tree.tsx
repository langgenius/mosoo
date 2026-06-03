import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File,
  Folder,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { ReactElement } from "react";

import type { AgentFileEntry, AgentFileTree } from "@/domains/agent/api/agent-file-browser-client";
import { cn } from "@/shared/lib/class-names";

import {
  formatBytes,
  formatRelativeTime,
  getVisibleSessionEntries,
  isCacheEntry,
  isExpandable,
  isSelectableFile,
  shortSessionId,
} from "./file-browser-model";
import type { FileTreeQueryState } from "./file-browser-model";

function getEntryIcon(entry: AgentFileEntry): ReactElement {
  if (entry.kind === "directory" || entry.kind === "space_mount") {
    return <Folder aria-hidden="true" className="size-4" />;
  }

  return <File aria-hidden="true" className="size-4" />;
}

function getPersistenceClass(entry: AgentFileEntry): string {
  return entry.persistence === "persistent" ? "bg-violet-500" : "bg-zinc-300";
}

function getVisibleEntries(
  entriesByPath: ReadonlyMap<string, AgentFileEntry[]>,
  path: string,
): AgentFileEntry[] {
  return (entriesByPath.get(path) ?? []).filter((entry) => !isCacheEntry(entry));
}

export function SandboxStatusNotice({ tree }: { tree: AgentFileTree | null }): ReactElement | null {
  if (tree === null) {
    return null;
  }

  if (tree.sandboxStatus === "missing") {
    return (
      <div className="border-border-subtle bg-paper-100 text-muted-foreground border-b px-4 py-2 text-[12px]">
        Sandbox not started yet.
      </div>
    );
  }

  if (tree.sandboxStatus === "cold" || tree.sandboxStatus === "restoring") {
    return (
      <div className="border-border-subtle border-b bg-amber-50 px-4 py-2 text-[12px] text-amber-900">
        Waking sandbox…
      </div>
    );
  }

  if (tree.sandboxStatus === "unsupported") {
    return (
      <div className="border-border-subtle border-b bg-amber-50 px-4 py-2 text-[12px] text-amber-900">
        {tree.lastError ?? "File Browser is not supported for this agent."}
      </div>
    );
  }

  if (tree.sandboxStatus === "destroying" || tree.sandboxStatus === "error") {
    return (
      <div className="border-border-subtle border-b bg-red-50 px-4 py-2 text-[12px] text-red-700">
        {tree.lastError ?? "Sandbox is not available."}
      </div>
    );
  }

  return null;
}

function FileTreeRow({
  depth,
  entry,
  expanded,
  selectedPath,
  onOpenSpace,
  onSelectFile,
  onToggleDirectory,
}: {
  depth: number;
  entry: AgentFileEntry;
  expanded: boolean;
  selectedPath: string | null;
  onOpenSpace: (entry: AgentFileEntry) => void;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
}): ReactElement {
  const canExpand = isExpandable(entry);
  const selected = selectedPath === entry.path;
  const sessionLabel =
    entry.session === null
      ? null
      : `${shortSessionId(entry.session.id)} · ${entry.session.status.toLowerCase()} · ${
          entry.session.title ?? "untitled"
        } · ${formatRelativeTime(entry.session.updatedAt)}`;

  return (
    <button
      type="button"
      title={entry.path}
      onClick={() => {
        if (entry.kind === "space_mount") {
          onOpenSpace(entry);
          return;
        }

        if (canExpand) {
          onToggleDirectory(entry.path);
          return;
        }

        if (isSelectableFile(entry)) {
          onSelectFile(entry.path);
        }
      }}
      className={cn(
        "group flex h-8 w-full items-center gap-1.5 overflow-hidden px-3 text-left text-[12.5px] outline-none transition-colors",
        selected ? "bg-ink-100 text-fg-1" : "text-fg-2 hover:bg-paper-200/70 hover:text-fg-1",
      )}
      style={{ paddingLeft: 12 + depth * 16 }}
    >
      <span className="text-fg-3 flex size-4 shrink-0 items-center justify-center">
        {canExpand ? (
          expanded ? (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-3.5" />
          )
        ) : entry.kind === "space_mount" ? (
          <ExternalLink aria-hidden="true" className="size-3.5" />
        ) : null}
      </span>
      <span className={cn("size-2 shrink-0 rounded-full", getPersistenceClass(entry))} />
      <span className="text-fg-3 shrink-0">{getEntryIcon(entry)}</span>
      <span className="min-w-0 flex-1 truncate">
        {entry.session === null ? entry.name : sessionLabel}
      </span>
      {entry.kind === "space_mount" && entry.space !== null ? (
        <span className="text-muted-foreground max-w-[132px] shrink-0 truncate font-mono text-[10.5px]">
          {entry.space.path}
        </span>
      ) : null}
      {entry.kind === "file" || entry.kind === "symlink" ? (
        <span className="text-muted-foreground shrink-0 font-mono text-[10.5px]">
          {formatBytes(entry.sizeBytes)}
        </span>
      ) : null}
    </button>
  );
}

function TreeLoadingRow({ depth }: { depth: number }): ReactElement {
  return (
    <div
      className="text-muted-foreground flex h-8 items-center gap-2 px-3 text-[12px]"
      style={{ paddingLeft: 12 + depth * 16 }}
    >
      <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
      Loading…
    </div>
  );
}

function TreeErrorRow({
  depth,
  message,
  onRetry,
}: {
  depth: number;
  message: string;
  onRetry: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="flex h-8 w-full items-center gap-2 px-3 text-left text-[12px] text-red-700 hover:bg-red-50"
      style={{ paddingLeft: 12 + depth * 16 }}
    >
      <RefreshCw aria-hidden="true" className="size-3.5" />
      <span className="truncate">{message}</span>
    </button>
  );
}

function EmptyDirectoryRow({ depth }: { depth: number }): ReactElement {
  return (
    <div
      className="text-muted-foreground flex h-8 items-center px-3 text-[12px]"
      style={{ paddingLeft: 28 + depth * 16 }}
    >
      Empty directory
    </div>
  );
}

function TruncatedDirectoryRow({
  depth,
  hiddenCount,
}: {
  depth: number;
  hiddenCount: number;
}): ReactElement {
  return (
    <div
      className="text-muted-foreground flex h-8 items-center px-3 text-[12px]"
      style={{ paddingLeft: 28 + depth * 16 }}
    >
      and {hiddenCount} more entries (open in Terminal to see all)
    </div>
  );
}

export function FileTree({
  entriesByPath,
  expandedPaths,
  onOpenSpace,
  onRetryPath,
  onSelectFile,
  onToggleDirectory,
  queryByPath,
  selectedPath,
  showOlderSessions,
  treeByPath,
  toggleOlderSessions,
}: {
  entriesByPath: ReadonlyMap<string, AgentFileEntry[]>;
  expandedPaths: ReadonlySet<string>;
  onOpenSpace: (entry: AgentFileEntry) => void;
  onRetryPath: (path: string) => void;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
  queryByPath: ReadonlyMap<string, FileTreeQueryState>;
  selectedPath: string | null;
  showOlderSessions: boolean;
  treeByPath: ReadonlyMap<string, AgentFileTree>;
  toggleOlderSessions: () => void;
}): ReactElement {
  function renderPath(path: string, depth: number): ReactElement[] {
    const entries = getVisibleEntries(entriesByPath, path);
    const tree = treeByPath.get(path);
    const children =
      path === "/workspace/se"
        ? getVisibleSessionEntries({ entries, showOlderSessions })
        : { hiddenCount: 0, visibleEntries: entries };
    const rows: ReactElement[] = [];

    for (const entry of children.visibleEntries) {
      const expanded = expandedPaths.has(entry.path);
      rows.push(
        <FileTreeRow
          key={entry.path}
          depth={depth}
          entry={entry}
          expanded={expanded}
          selectedPath={selectedPath}
          onOpenSpace={onOpenSpace}
          onSelectFile={onSelectFile}
          onToggleDirectory={onToggleDirectory}
        />,
      );

      if (expanded && isExpandable(entry)) {
        const query = queryByPath.get(entry.path);

        if (query?.isLoading === true) {
          rows.push(<TreeLoadingRow key={`${entry.path}:loading`} depth={depth + 1} />);
        } else if (query?.isError === true) {
          rows.push(
            <TreeErrorRow
              key={`${entry.path}:error`}
              depth={depth + 1}
              message={query.error?.message ?? "Failed to load directory."}
              onRetry={() => {
                onRetryPath(entry.path);
              }}
            />,
          );
        } else if (getVisibleEntries(entriesByPath, entry.path).length === 0) {
          rows.push(<EmptyDirectoryRow key={`${entry.path}:empty`} depth={depth + 1} />);
        } else {
          rows.push(...renderPath(entry.path, depth + 1));
        }
      }
    }

    if (path === "/workspace/se" && children.hiddenCount > 0) {
      rows.push(
        <button
          key="/workspace/se:older"
          type="button"
          onClick={toggleOlderSessions}
          className="text-muted-foreground hover:bg-paper-200/70 flex h-8 w-full items-center gap-1.5 px-3 text-left text-[12px]"
          style={{ paddingLeft: 12 + depth * 16 }}
        >
          <ChevronRight aria-hidden="true" className="size-3.5" />
          Older sessions ({children.hiddenCount} hidden)
        </button>,
      );
    }

    if (tree?.truncated === true) {
      rows.push(
        <TruncatedDirectoryRow
          key={`${path}:truncated`}
          depth={depth}
          hiddenCount={Math.max(0, tree.totalCount - entries.length)}
        />,
      );
    }

    return rows;
  }

  const rootRows = renderPath("/", 0);
  const rootQuery = queryByPath.get("/");

  if (rootQuery?.isLoading === true) {
    return (
      <div className="min-h-0 flex-1 overflow-auto py-2">
        <TreeLoadingRow depth={0} />
      </div>
    );
  }

  if (rootQuery?.isError === true) {
    return (
      <div className="min-h-0 flex-1 overflow-auto py-2">
        <TreeErrorRow
          depth={0}
          message={rootQuery.error?.message ?? "Failed to load file tree."}
          onRetry={() => {
            onRetryPath("/");
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto py-2">
      {rootRows.length === 0 ? (
        <div className="text-muted-foreground px-4 py-8 text-center text-[13px]">No files</div>
      ) : (
        rootRows
      )}
    </div>
  );
}
