import {
  Archive,
  Bell,
  ChevronDown,
  ChevronRight,
  Inbox,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";

import { AgentAvatar } from "../agent-avatar";
import { getNotificationPermission, formatShortRelative } from "../model/format";
import { getThreadActionCapabilities } from "../model/session-capabilities";
import { getThreadStateGlyph } from "../model/thread";
import type { ThreadFilter, ThreadListItem, ThreadSection } from "../model/thread";
import { ThreadStateIcon } from "../thread-state-icon";

const THREAD_FILTERS: { label: string; value: ThreadFilter }[] = [
  { label: "All", value: "all" },
  { label: "Unread", value: "unread" },
  { label: "Pinned", value: "pinned" },
  { label: "Failed", value: "failed" },
];

const SECTION_LABELS: Record<ThreadSection, string> = {
  archived: "Archive",
  completed: "Completed",
  pinned: "Pinned",
  working: "Working",
};

export function ThreadFilterBar({
  activeFilter,
  counts,
  onFilterChange,
}: {
  activeFilter: ThreadFilter;
  counts: Record<ThreadFilter, number>;
  onFilterChange: (filter: ThreadFilter) => void;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {THREAD_FILTERS.map((filter) => (
        <button
          key={filter.value}
          type="button"
          onClick={() => {
            onFilterChange(filter.value);
          }}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold transition-colors",
            activeFilter === filter.value
              ? "bg-ink-900 text-white"
              : "text-fg-2 hover:bg-ink-900/[0.05] hover:text-fg-1",
          )}
        >
          <span>{filter.label}</span>
          <span
            className={cn(
              "text-[10.5px] font-medium",
              activeFilter === filter.value ? "opacity-80" : "opacity-60",
            )}
          >
            {counts[filter.value]}
          </span>
        </button>
      ))}
    </div>
  );
}

export function NotificationPrompt({
  dismissed,
  onDismiss,
}: {
  dismissed: boolean;
  onDismiss: () => void;
}): ReactElement | null {
  const [permission, setPermission] = useState(getNotificationPermission);

  if (dismissed || permission === "granted" || permission === "unsupported") {
    return null;
  }

  return (
    <div className="border-border-subtle bg-ink-50 mb-3 flex items-center gap-2 rounded-md border px-3 py-2">
      <Bell className="text-fg-3 size-3.5 shrink-0" />
      <div className="text-fg-2 min-w-0 flex-1 text-[12px] font-medium">
        Enable notifications to be pinged when an agent finishes.
      </div>
      <Button
        size="xs"
        variant="tonal"
        onClick={() => {
          void globalThis.Notification.requestPermission().then(setPermission);
        }}
      >
        Enable
      </Button>
      <Button size="icon-xs" variant="ghost" onClick={onDismiss} aria-label="Dismiss">
        <ChevronRight className="size-3" />
      </Button>
    </div>
  );
}

function ThreadRow({
  onArchive,
  onDelete,
  onOpen,
  onPinToggle,
  thread,
}: {
  onArchive: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  onOpen: (threadId: string) => void;
  onPinToggle: (threadId: string) => void;
  thread: ThreadListItem;
}): ReactElement {
  const stateGlyph = getThreadStateGlyph({
    bucket: thread.bucket,
    failed: thread.failed,
  });
  const actionCapabilities = getThreadActionCapabilities({
    bucket: thread.bucket,
    capabilities: thread.actionCapabilities,
  });

  return (
    <div className="group hover:bg-ink-900/[0.025] relative flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5 transition-colors">
      <button
        type="button"
        onClick={() => {
          onOpen(thread.id);
        }}
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
      >
        <span
          className={cn(
            "shrink-0 rounded-full",
            thread.read ? "bg-transparent size-1.5" : "bg-accent size-1.5",
          )}
          aria-hidden
        />

        <ThreadStateIcon glyph={stateGlyph} />

        <AgentAvatar
          agent={thread.agent}
          defaultName={thread.agentName}
          className="size-5 text-[9px] font-bold"
        />

        {thread.pinned ? (
          <Pin className="text-amber -mr-1 size-3 shrink-0" aria-label="Pinned" />
        ) : null}

        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[12.5px] tracking-tight",
            thread.read ? "text-fg-2" : "text-fg-1 font-semibold",
          )}
          title={thread.title}
        >
          {thread.title}
        </span>

        <span className="text-fg-3 shrink-0 text-[12px]">[{thread.agentName}]</span>

        <span
          className={cn("shrink-0 text-[12px]", thread.failed ? "text-destructive" : "text-fg-3")}
        >
          {thread.statusLine}
        </span>

        <span className="text-fg-3 shrink-0 text-[11.5px] tabular-nums">
          {formatShortRelative(thread.lastActivityAt)}
        </span>
      </button>

      <div
        className={cn(
          "pointer-events-none absolute inset-y-1 right-1.5 opacity-0 transition-opacity",
          "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
          "group-hover:pointer-events-auto group-hover:opacity-100",
        )}
      >
        <div
          className="absolute inset-0 rounded-md"
          style={{
            backgroundImage:
              "linear-gradient(rgba(11,26,20,0.025),rgba(11,26,20,0.025)),linear-gradient(var(--bg),var(--bg))",
            maskImage: "linear-gradient(to right, transparent, black 24px)",
            WebkitMaskImage: "linear-gradient(to right, transparent, black 24px)",
          }}
          aria-hidden
        />
        <div className="relative flex h-full items-center gap-0.5 pr-1 pl-7">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={thread.pinned ? "Unpin thread" : "Pin thread"}
            onClick={() => {
              onPinToggle(thread.id);
            }}
          >
            {thread.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </Button>
          {actionCapabilities.archive.available ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Archive thread"
              onClick={() => {
                onArchive(thread.id);
              }}
            >
              <Archive className="size-3.5" />
            </Button>
          ) : null}
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Delete thread"
            disabled={!actionCapabilities.delete.available}
            title={actionCapabilities.delete.reason ?? undefined}
            onClick={() => {
              onDelete(thread.id);
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ThreadSectionGroup({
  collapsed,
  onArchive,
  onCollapseChange,
  onDelete,
  onOpenThread,
  onPinToggle,
  section,
  threads,
}: {
  collapsed: boolean;
  onArchive: (threadId: string) => void;
  onCollapseChange: (collapsed: boolean) => void;
  onDelete: (threadId: string) => void;
  onOpenThread: (threadId: string) => void;
  onPinToggle: (threadId: string) => void;
  section: ThreadSection;
  threads: ThreadListItem[];
}): ReactElement | null {
  if (threads.length === 0 && section === "pinned") {
    return null;
  }

  if (threads.length === 0 && section === "archived") {
    return (
      <section>
        <button
          type="button"
          onClick={() => {
            onCollapseChange(!collapsed);
          }}
          className="text-fg-3 hover:text-fg-1 flex h-7 items-center gap-1.5 text-[11px] font-bold tracking-[0.12em] uppercase"
        >
          {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
          {SECTION_LABELS[section]} ({threads.length})
        </button>
      </section>
    );
  }

  return (
    <section>
      <button
        type="button"
        onClick={() => {
          onCollapseChange(!collapsed);
        }}
        className="text-fg-3 hover:text-fg-1 flex h-7 items-center gap-1.5 text-[11px] font-bold tracking-[0.12em] uppercase"
      >
        {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        {SECTION_LABELS[section]} ({threads.length})
      </button>
      {collapsed ? null : (
        <div className="mt-1 flex flex-col gap-0.5">
          {threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              onArchive={onArchive}
              onDelete={onDelete}
              onOpen={onOpenThread}
              onPinToggle={onPinToggle}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function ThreadsEmptyState({ onNewThread }: { onNewThread: () => void }): ReactElement {
  return (
    <EmptyState
      icon={Inbox}
      title="No threads yet"
      description="Dispatch your first task to an agent."
    >
      <Button onClick={onNewThread} size="sm">
        <Plus className="size-3.5" />
        New thread
      </Button>
    </EmptyState>
  );
}
