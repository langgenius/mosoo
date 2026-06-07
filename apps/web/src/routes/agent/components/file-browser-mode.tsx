import { useQuery, useQueryClient, useQueries } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import {
  getAgentFileContent,
  getAgentFileTree,
} from "@/domains/agent/api/agent-file-browser-client";
import type { AgentFileEntry, AgentFileTree } from "@/domains/agent/api/agent-file-browser-client";
import { toAgentId } from "@/routes/typed-id";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";

import type { Agent } from "../agent.types";
import {
  DEFAULT_EXPANDED_PATHS,
  MANUAL_REFRESH_QUERY_OPTIONS,
  agentFileBrowserKeys,
} from "./file-browser-model";
import type { FileTreeQueryState } from "./file-browser-model";
import { FilePreview } from "./file-browser-preview";
import { FileTree, SandboxStatusNotice } from "./file-browser-tree";

export function FileBrowserMode({ agent }: { agent: Agent }): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(
    () => new Set(DEFAULT_EXPANDED_PATHS),
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showOlderSessions, setShowOlderSessions] = useState(false);
  const typedAgentId = toAgentId(agent.id);
  const expandedPathList = useMemo(() => [...expandedPaths].toSorted(), [expandedPaths]);
  const treeQueries = useQueries({
    queries: expandedPathList.map((path) => ({
      ...MANUAL_REFRESH_QUERY_OPTIONS,
      queryFn: async () => getAgentFileTree({ agentId: typedAgentId, path }),
      queryKey: agentFileBrowserKeys.tree(agent.id, path),
    })),
  });
  const treeByPath = useMemo(() => {
    const next = new Map<string, AgentFileTree>();

    expandedPathList.forEach((path, index) => {
      const data = treeQueries[index]?.data;

      if (data !== undefined) {
        next.set(path, data);
      }
    });

    return next;
  }, [expandedPathList, treeQueries]);
  const queryByPath = useMemo(() => {
    const next = new Map<string, FileTreeQueryState>();

    expandedPathList.forEach((path, index) => {
      const query = treeQueries[index];

      if (query !== undefined) {
        next.set(path, {
          error: query.error instanceof Error ? query.error : null,
          isError: query.isError,
          isLoading: query.isLoading,
        });
      }
    });

    return next;
  }, [expandedPathList, treeQueries]);
  const entriesByPath = useMemo(() => {
    const next = new Map<string, AgentFileEntry[]>();

    for (const [path, tree] of treeByPath) {
      next.set(path, tree.entries);
    }

    return next;
  }, [treeByPath]);
  const rootTree = treeByPath.get("/") ?? null;
  const contentQuery = useQuery({
    enabled: selectedPath !== null,
    ...MANUAL_REFRESH_QUERY_OPTIONS,
    queryFn: async () => {
      if (selectedPath === null) {
        throw new Error("File path is required.");
      }

      return getAgentFileContent({ agentId: typedAgentId, path: selectedPath });
    },
    queryKey:
      selectedPath === null
        ? ["agent", "file-browser", agent.id, "content", "missing"]
        : agentFileBrowserKeys.content(agent.id, selectedPath),
  });
  const refreshing = treeQueries.some((query) => query.isFetching);

  function toggleDirectory(path: string): void {
    setExpandedPaths((current) => {
      const next = new Set(current);

      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }

      return next;
    });
  }

  function retryPath(path: string): void {
    void queryClient.invalidateQueries({
      queryKey: agentFileBrowserKeys.tree(agent.id, path),
    });
  }

  function refreshExpandedPaths(): void {
    void Promise.all(
      expandedPathList.map((path) =>
        queryClient.invalidateQueries({
          queryKey: agentFileBrowserKeys.tree(agent.id, path),
        }),
      ),
    );

    if (selectedPath !== null) {
      void queryClient.invalidateQueries({
        queryKey: agentFileBrowserKeys.content(agent.id, selectedPath),
      });
    }
  }

  function openSpace(entry: AgentFileEntry): void {
    if (entry.space === null) {
      return;
    }

    void navigate(entry.space.url);
  }

  return (
    <div className="bg-paper-50 flex h-full min-h-0">
      <aside className="border-border-subtle flex w-[360px] max-w-[42vw] min-w-[300px] shrink-0 flex-col border-r bg-white">
        <div className="border-border-subtle flex h-12 shrink-0 items-center justify-between border-b px-4">
          <div className="min-w-0">
            <div className="text-fg-1 text-[13px] font-semibold">File System</div>
            <div className="text-muted-foreground font-mono text-[10.5px]">Agent home</div>
          </div>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={refreshExpandedPaths}
            disabled={refreshing}
            aria-label="Refresh"
          >
            <RefreshCw aria-hidden="true" className={cn("size-4", refreshing && "animate-spin")} />
          </Button>
        </div>
        <SandboxStatusNotice tree={rootTree} />
        <FileTree
          entriesByPath={entriesByPath}
          expandedPaths={expandedPaths}
          onOpenSpace={openSpace}
          onRetryPath={retryPath}
          onSelectFile={setSelectedPath}
          onToggleDirectory={toggleDirectory}
          queryByPath={queryByPath}
          selectedPath={selectedPath}
          showOlderSessions={showOlderSessions}
          treeByPath={treeByPath}
          toggleOlderSessions={() => {
            setShowOlderSessions((current) => !current);
          }}
        />
        <div className="border-border-subtle text-muted-foreground flex h-9 shrink-0 items-center gap-4 border-t px-4 text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-green-600" />
            Persistent
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="bg-ink-300 size-2 rounded-full" />
            Temporary
          </span>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <FilePreview
          agentId={agent.id}
          content={contentQuery.data ?? null}
          contentError={contentQuery.error instanceof Error ? contentQuery.error : null}
          contentLoading={contentQuery.isLoading}
          onClose={() => {
            setSelectedPath(null);
          }}
          onRetry={() => {
            void contentQuery.refetch();
          }}
          selectedPath={selectedPath}
        />
      </main>
    </div>
  );
}
