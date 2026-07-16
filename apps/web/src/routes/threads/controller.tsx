import { Inbox, Plus } from "lucide-react";
import { useCallback, useMemo } from "react";
import type { ReactElement } from "react";

import { useAppSession } from "@/app/session-provider";
import type { ListedFileEntry } from "@/domains/file/api/files";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { ListPageContent, ListPageToolbar, ListPageToolbarSpacer } from "@/shared/ui/list-page";
import { PageHeader } from "@/shared/ui/page-header";

import { NewThreadDialog } from "./compose/new-dialog";
import { ThreadDetail, ThreadsMissingDetail } from "./detail/view";
import {
  NotificationPrompt,
  ThreadFilterBar,
  ThreadSectionGroup,
  ThreadsEmptyState,
} from "./list/view";
import { useThreadCompletionNotifications } from "./model/completion-notifications";
import { getMutationErrorMessage } from "./model/format";
import { useSelectedThreadReadSync } from "./model/read-sync";
import { useThreadRouteState } from "./model/route-state";
import { SECTION_ORDER } from "./model/thread";
import { useThreadUiState } from "./model/ui-state";
import { useThreadActions } from "./model/use-actions";
import { useThreadQueries } from "./model/use-queries";

interface ThreadsWorkspaceProps {
  activeAppId: string | null;
  userId: string | null;
  viewerImage: string | null;
  viewerName: string;
}

const EMPTY_ARTIFACTS: ListedFileEntry[] = [];

export function ThreadsController(): ReactElement {
  const { activeAppId, user } = useAppSession();
  const scopeKey = `${user?.id ?? "guest"}:${activeAppId ?? "none"}`;

  return (
    <ThreadsWorkspace
      key={scopeKey}
      activeAppId={activeAppId}
      userId={user?.id ?? null}
      viewerImage={user?.image ?? null}
      viewerName={user?.name ?? "You"}
    />
  );
}

function ThreadsWorkspace({
  activeAppId,
  userId,
  viewerImage,
  viewerName,
}: ThreadsWorkspaceProps): ReactElement {
  const route = useThreadRouteState();
  const ui = useThreadUiState({
    appId: activeAppId,
    userId,
  });
  const threadUiSnapshot = useMemo(
    () => ({
      pinnedThreadIds: new Set(ui.state.pinnedThreadIds),
      readAtByThreadId: ui.state.readAtByThreadId,
    }),
    [ui.state.pinnedThreadIds, ui.state.readAtByThreadId],
  );
  const threads = useThreadQueries({
    activeAppId,
    activeThreadId: route.activeThreadId,
    filter: ui.state.filter,
    ui: threadUiSnapshot,
  });
  const actions = useThreadActions({
    activeAppId,
    activeThreadId: route.activeThreadId,
    allThreads: threads.allThreads,
    closeComposeDialog: route.closeComposeDialog,
    markThreadReadLocal: ui.markThreadRead,
    navigateToList: route.backToList,
    togglePinnedThreadLocal: ui.togglePinnedThread,
  });
  const handleReadSyncError = useCallback(
    (error: unknown) => {
      actions.setActionError(getMutationErrorMessage(error, "Failed to mark thread read."));
    },
    [actions],
  );

  useThreadCompletionNotifications(threads.allThreads);
  useSelectedThreadReadSync({
    markRead: actions.markThreadRead,
    onError: handleReadSyncError,
    selectedThread: threads.selectedThread,
  });

  if (route.activeThreadId !== null) {
    return (
      <div className="bg-background flex h-full flex-1 flex-col overflow-hidden">
        {threads.selectedThread ? (
          <ThreadDetail
            actionError={actions.actionError}
            agent={threads.selectedThread.agent}
            artifacts={threads.artifactsQuery.data?.files ?? EMPTY_ARTIFACTS}
            messages={threads.messagesQuery.data ?? []}
            messagesError={
              threads.messagesQuery.error instanceof Error ? threads.messagesQuery.error : null
            }
            messagesLoading={threads.messagesQuery.isLoading}
            processEvents={threads.processEventsQuery.data ?? []}
            processEventsError={
              threads.processEventsQuery.error instanceof Error
                ? threads.processEventsQuery.error
                : null
            }
            processEventsLoading={threads.processEventsQuery.isLoading}
            sessionActionCapabilities={
              threads.retrieveQuery.data?.agentSessionRetrieve.capabilities ?? null
            }
            sending={actions.sendingFollowUp}
            thread={threads.selectedThread}
            viewer={{ image: viewerImage, name: viewerName }}
            onArchive={(threadId) => {
              void actions.archiveThread(threadId);
            }}
            onBack={route.backToList}
            onDelete={(threadId) => {
              void actions.deleteThread(threadId);
            }}
            onSendFollowUp={actions.sendFollowUp}
            onTogglePinned={(threadId) => {
              void actions.togglePinnedThread(threadId);
            }}
          />
        ) : threads.isLoading ? (
          <div className="text-fg-3 flex h-full items-center justify-center text-[13px]">
            Loading thread…
          </div>
        ) : (
          <ThreadsMissingDetail onBack={route.backToList} />
        )}

        <NewThreadDialog
          key={route.composeOpen ? "open" : "closed"}
          agents={threads.agentsQuery.data ?? []}
          error={actions.createError}
          lastAgentId={ui.state.lastAgentId}
          lockedAgentId={route.lockedAgentId}
          onLastAgentChange={ui.setLastAgentId}
          onOpenChange={(open) => {
            if (!open) {
              route.closeComposeDialog();
            }
          }}
          onSubmit={actions.createThread}
          open={route.composeOpen}
          submitting={actions.creatingThread}
        />
      </div>
    );
  }

  return (
    <div className="bg-background flex h-full flex-1 flex-col overflow-hidden">
      <PageHeader
        title="Threads"
        description="Dispatch agents and track progress. Reopen threads by replying asynchronously."
      >
        <Button onClick={route.openComposeDialog} size="sm">
          <Plus className="size-3.5" />
          New thread
        </Button>
      </PageHeader>

      <ListPageToolbar>
        <ThreadFilterBar
          activeFilter={ui.state.filter}
          counts={threads.counts}
          onFilterChange={ui.setFilter}
        />
        <ListPageToolbarSpacer />
        <div className="text-fg-3 text-[12px] tabular-nums">
          <span className={threads.bucketCounts.working > 0 ? "text-fg-1 font-medium" : undefined}>
            {threads.bucketCounts.working} working
          </span>
          <span className="mx-1.5">·</span>
          <span>{threads.bucketCounts.completed} completed</span>
          <span className="mx-1.5">·</span>
          <span>({threads.bucketCounts.archived} archived)</span>
        </div>
      </ListPageToolbar>

      <ListPageContent>
        <NotificationPrompt
          dismissed={ui.state.dismissedNotificationPrompt}
          onDismiss={() => {
            ui.setDismissedNotificationPrompt(true);
          }}
        />

        {threads.loadError ? (
          <div className="text-destructive border-destructive/20 bg-destructive/[0.06] rounded-md border px-3 py-2 text-[13px]">
            {getMutationErrorMessage(threads.loadError, "Failed to load threads.")}
          </div>
        ) : threads.isLoading ? (
          <div className="text-fg-3 py-12 text-center text-[13px]">Loading threads…</div>
        ) : threads.allThreads.length === 0 ? (
          <ThreadsEmptyState onNewThread={route.openComposeDialog} />
        ) : threads.filteredThreads.length === 0 ? (
          <div className="py-12">
            <EmptyState
              icon={Inbox}
              title="No matching threads"
              description="Try another filter."
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {SECTION_ORDER.map((section) => (
              <ThreadSectionGroup
                key={section}
                section={section}
                collapsed={ui.state.collapsedSections[section]}
                threads={threads.threadsBySection[section]}
                onArchive={(threadId) => {
                  void actions.archiveThread(threadId);
                }}
                onCollapseChange={(collapsed) => {
                  ui.setSectionCollapsed(section, collapsed);
                }}
                onDelete={(threadId) => {
                  void actions.deleteThread(threadId);
                }}
                onOpenThread={route.openThread}
                onPinToggle={(threadId) => {
                  void actions.togglePinnedThread(threadId);
                }}
              />
            ))}
          </div>
        )}
      </ListPageContent>

      <NewThreadDialog
        key={route.composeOpen ? "open" : "closed"}
        agents={threads.agentsQuery.data ?? []}
        error={actions.createError}
        lastAgentId={ui.state.lastAgentId}
        lockedAgentId={route.lockedAgentId}
        onLastAgentChange={ui.setLastAgentId}
        onOpenChange={(open) => {
          if (!open) {
            route.closeComposeDialog();
          }
        }}
        onSubmit={actions.createThread}
        open={route.composeOpen}
        submitting={actions.creatingThread}
      />
    </div>
  );
}
