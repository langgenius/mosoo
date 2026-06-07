import type { AgentSummary } from "@mosoo/contracts/agent";
import type {
  AgentSessionActionCapability,
  SessionMessage,
  SessionProcessEvent,
} from "@mosoo/contracts/session";
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  Inbox,
  MoreHorizontal,
  Paperclip,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";

import { triggerAgentSessionPrewarm } from "@/domains/session/api/agent-session";
import { toSessionId } from "@/routes/typed-id";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { EmptyState } from "@/shared/ui/empty-state";
import { Markdown } from "@/shared/ui/markdown";
import { Textarea } from "@/shared/ui/textarea";

import { AgentAvatar } from "../agent-avatar";
import { formatRelativeTime } from "../model/format";
import { getThreadActionCapabilities } from "../model/session-capabilities";
import { getThreadStateGlyph, isThreadWorking } from "../model/thread";
import type { ThreadListItem } from "../model/thread";
import { ThreadProcessModal } from "../process-modal/modal";
import { ThreadStateIcon } from "../thread-state-icon";
import { UserAvatar } from "../user-avatar";

interface ViewerInfo {
  image: string | null;
  name: string;
}

function ThreadActivityCard({
  agent,
  agentName,
  message,
  onOpenProcess,
  processButtonText,
  processEventCount,
  viewer,
}: {
  agent: AgentSummary | null;
  agentName: string;
  message: SessionMessage;
  onOpenProcess: () => void;
  processButtonText: string;
  processEventCount: number;
  viewer: ViewerInfo;
}): ReactElement {
  const [open, setOpen] = useState(true);
  const isUser = message.role === "user";
  const kindLabel = isUser ? "user comment" : "agent reply";
  const author = isUser ? viewer.name : agentName;

  return (
    <div className="border-border-subtle bg-card rounded-lg border">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className="hover:bg-ink-900/[0.02] flex w-full items-center gap-2 rounded-t-lg px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown className="text-fg-3 size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="text-fg-3 size-3.5 shrink-0" />
        )}
        {isUser ? (
          <UserAvatar
            image={viewer.image}
            name={viewer.name}
            className="size-5 text-[9px] font-bold"
          />
        ) : (
          <AgentAvatar
            agent={agent}
            defaultName={agentName}
            className="size-5 text-[9px] font-bold"
          />
        )}
        <span className="text-fg-1 shrink-0 text-[12.5px] font-semibold">{author}</span>
        <span className="text-fg-3 shrink-0 text-[11.5px]">{kindLabel}</span>
        <span className="text-fg-3 ml-auto shrink-0 text-[11.5px]">
          {formatRelativeTime(message.createdAt)}
        </span>
      </button>
      {open ? (
        <div className="border-border-subtle border-t px-4 py-3">
          {isUser ? (
            <div className="text-fg-1 text-[13.5px] leading-relaxed whitespace-pre-wrap">
              {message.content}
            </div>
          ) : (
            <div className="text-fg-1 text-[13.5px] leading-relaxed">
              <Markdown>{message.content}</Markdown>
            </div>
          )}
          {!isUser ? (
            <div className="mt-3">
              <Button
                size="xs"
                variant="outline"
                className="font-mono text-[11px]"
                onClick={onOpenProcess}
              >
                <ChevronRight className="size-3" />
                {processButtonText}
                {processEventCount > 0 ? (
                  <span className="text-fg-3 ml-1">· {processEventCount} events</span>
                ) : null}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ThreadDetailHeader({
  onArchive,
  onBack,
  onDelete,
  onOpenProcess,
  onTogglePinned,
  stateGlyph,
  thread,
  threadActionCapabilities,
  working,
}: {
  onArchive: (threadId: string) => void;
  onBack: () => void;
  onDelete: (threadId: string) => void;
  onOpenProcess: () => void;
  onTogglePinned: (threadId: string) => void;
  stateGlyph: ReturnType<typeof getThreadStateGlyph>;
  thread: ThreadListItem;
  threadActionCapabilities: ReturnType<typeof getThreadActionCapabilities>;
  working: boolean;
}): ReactElement {
  return (
    <div className="border-border-subtle flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <Button size="icon-sm" variant="ghost" onClick={onBack} aria-label="Back to threads">
        <ArrowLeft className="size-4" />
      </Button>
      <div className="text-fg-3 flex min-w-0 items-center gap-1.5 text-[12px]">
        <button type="button" onClick={onBack} className="hover:text-fg-1 transition-colors">
          Threads
        </button>
        <ChevronRight className="size-3 shrink-0" />
        <span className="text-fg-1 truncate text-[12.5px] font-medium" title={thread.title}>
          {thread.title}
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {working && !thread.failed ? (
          <Badge
            asChild
            variant="primary"
            className="cursor-pointer hover:bg-green-100 focus-visible:ring-offset-1"
          >
            <button
              type="button"
              aria-label="Open event flow"
              title="Open event flow"
              onClick={onOpenProcess}
            >
              <ThreadStateIcon glyph={stateGlyph} />
              <span>Working</span>
            </button>
          </Badge>
        ) : (
          <Badge variant={thread.failed ? "danger" : "outline"}>
            <ThreadStateIcon glyph={stateGlyph} />
            <span>
              {thread.failed ? "Failed" : thread.bucket === "archived" ? "Archived" : "Completed"}
            </span>
          </Badge>
        )}
        {threadActionCapabilities.archive.available ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onArchive(thread.id);
            }}
          >
            <Archive className="size-3.5" />
            Archive
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More actions">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                onTogglePinned(thread.id);
              }}
            >
              {thread.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
              {thread.pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!threadActionCapabilities.delete.available}
              title={threadActionCapabilities.delete.reason ?? undefined}
              onSelect={() => {
                onDelete(thread.id);
              }}
            >
              <Trash2 className="size-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function ThreadReplyComposer({
  actionError,
  canSend,
  followUpMode,
  onChangeReply,
  onSend,
  readOnlyReason,
  reply,
  thread,
  threadActionCapabilities,
}: {
  actionError: string | null;
  canSend: boolean;
  followUpMode: boolean;
  onChangeReply: (reply: string) => void;
  onSend: () => Promise<void>;
  readOnlyReason: string | null;
  reply: string;
  thread: ThreadListItem;
  threadActionCapabilities: ReturnType<typeof getThreadActionCapabilities>;
}): ReactElement {
  return (
    <div className="border-border-subtle bg-background shrink-0 border-t px-6 py-4">
      <div className="mx-auto max-w-[760px]">
        {readOnlyReason ? (
          <div className="border-border bg-muted/40 text-fg-2 mb-2 rounded-md border px-3 py-2 text-[12.5px]">
            {readOnlyReason}
          </div>
        ) : null}
        {actionError ? (
          <div className="border-destructive/20 bg-destructive/[0.06] text-destructive mb-2 rounded-md border px-3 py-2 text-[12.5px]">
            {actionError}
          </div>
        ) : null}
        <div className="border-border-subtle bg-card flex items-end gap-2 rounded-lg border px-3 py-2.5 shadow-[var(--shadow-sm)]">
          <Textarea
            value={reply}
            onChange={(event) => {
              const nextValue = event.target.value;
              onChangeReply(nextValue);
              if (
                followUpMode &&
                nextValue.length > 0 &&
                threadActionCapabilities.followUp.available
              ) {
                triggerAgentSessionPrewarm(toSessionId(thread.id));
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void onSend();
              }
            }}
            className="max-h-[200px] min-h-[36px] flex-1 resize-none border-0 bg-transparent p-0 text-[13px] shadow-none focus-visible:ring-0"
            placeholder={
              followUpMode ? `Follow up and re-dispatch to ${thread.agentName}` : "Add a comment..."
            }
          />
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label="Attach files"
            className="text-fg-3 shrink-0"
            disabled
          >
            <Paperclip className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={!canSend}
            aria-label={followUpMode ? "Follow up" : "Send comment"}
            className="text-fg-3 hover:text-fg-1 shrink-0"
            onClick={() => {
              void onSend();
            }}
          >
            {followUpMode ? (
              <RotateCcw className="size-3.5" />
            ) : (
              <CornerDownLeft className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ThreadDetail({
  actionError,
  agent,
  messages,
  messagesError,
  messagesLoading,
  onArchive,
  onBack,
  onDelete,
  onSendFollowUp,
  onTogglePinned,
  processEvents,
  processEventsError,
  processEventsLoading,
  sessionActionCapabilities,
  sending,
  thread,
  viewer,
}: {
  actionError: string | null;
  agent: AgentSummary | null;
  messages: SessionMessage[];
  messagesError: Error | null;
  messagesLoading: boolean;
  onArchive: (threadId: string) => void;
  onBack: () => void;
  onDelete: (threadId: string) => void;
  onSendFollowUp: (input: { body: string; thread: ThreadListItem }) => Promise<void>;
  onTogglePinned: (threadId: string) => void;
  processEvents: SessionProcessEvent[];
  processEventsError: Error | null;
  processEventsLoading: boolean;
  sessionActionCapabilities: readonly AgentSessionActionCapability[] | null;
  sending: boolean;
  thread: ThreadListItem;
  viewer: ViewerInfo;
}): ReactElement {
  const [reply, setReply] = useState("");
  const [processOpen, setProcessOpen] = useState(false);
  const working = isThreadWorking(thread.session);
  const followUpMode = thread.bucket === "archived" || !working;
  const threadActionCapabilities = getThreadActionCapabilities({
    bucket: thread.bucket,
    capabilities: sessionActionCapabilities,
  });
  const readOnlyReason = threadActionCapabilities.followUp.available
    ? null
    : threadActionCapabilities.followUp.reason;
  const canSend =
    reply.trim().length > 0 && threadActionCapabilities.followUp.available && !sending;
  const processButtonText = processEventsLoading
    ? "Loading process"
    : processEventsError
      ? "Process unavailable"
      : "Show process";
  const stateGlyph = getThreadStateGlyph({ bucket: thread.bucket, failed: thread.failed });
  const firstUserMessage = messages.find((message) => message.role === "user") ?? null;
  const activityMessages = messages.filter((message) => message.id !== firstUserMessage?.id);

  async function send(): Promise<void> {
    if (!canSend) {
      return;
    }

    await onSendFollowUp({ body: reply.trim(), thread });
    setReply("");
  }

  return (
    <div className="bg-background flex h-full min-w-0 flex-1 flex-col">
      <ThreadDetailHeader
        onArchive={onArchive}
        onBack={onBack}
        onDelete={onDelete}
        onOpenProcess={() => {
          setProcessOpen(true);
        }}
        onTogglePinned={onTogglePinned}
        stateGlyph={stateGlyph}
        thread={thread}
        threadActionCapabilities={threadActionCapabilities}
        working={working}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-[760px]">
          <h1 className="text-fg-1 text-[24px] leading-tight font-bold">{thread.title}</h1>
          <div className="text-fg-3 mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
            <AgentAvatar
              agent={thread.agent}
              defaultName={thread.agentName}
              className="size-4 text-[8px] font-bold"
            />
            <span>{thread.agentName}</span>
            <span>·</span>
            <span>created {formatRelativeTime(thread.session.createdAt)}</span>
          </div>

          {firstUserMessage !== null ? (
            <div className="border-border-subtle bg-card mt-5 rounded-lg border px-4 py-3">
              <div className="text-fg-3 mb-1.5 text-[10.5px] font-bold tracking-[0.16em] uppercase">
                User request
              </div>
              <div className="text-fg-1 text-[13.5px] leading-relaxed whitespace-pre-wrap">
                {firstUserMessage.content}
              </div>
            </div>
          ) : null}

          {messagesLoading ? (
            <div className="text-fg-3 py-12 text-center text-[13px]">Loading thread…</div>
          ) : messagesError ? (
            <div className="text-destructive py-12 text-center text-[13px]">
              {messagesError.message}
            </div>
          ) : activityMessages.length === 0 && firstUserMessage === null ? (
            <EmptyState
              icon={Inbox}
              title="No messages yet"
              description="This thread exists, but no durable message has been recorded."
            />
          ) : activityMessages.length > 0 ? (
            <div className="mt-6">
              <div className="text-fg-2 mb-2.5 text-[12.5px] font-semibold">
                Activity · {activityMessages.length}
              </div>
              <div className="flex flex-col gap-2.5">
                {activityMessages.map((message) => (
                  <ThreadActivityCard
                    key={message.id}
                    agent={agent}
                    agentName={thread.agentName}
                    message={message}
                    onOpenProcess={() => {
                      setProcessOpen(true);
                    }}
                    processButtonText={processButtonText}
                    processEventCount={processEvents.length}
                    viewer={viewer}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ThreadReplyComposer
        actionError={actionError}
        canSend={canSend}
        followUpMode={followUpMode}
        onChangeReply={setReply}
        onSend={send}
        readOnlyReason={readOnlyReason}
        reply={reply}
        thread={thread}
        threadActionCapabilities={threadActionCapabilities}
      />

      <ThreadProcessModal
        agent={agent}
        agentName={thread.agentName}
        errorMessage={processEventsError?.message ?? null}
        events={processEvents}
        onOpenChange={setProcessOpen}
        open={processOpen}
        threadFailed={thread.failed}
        threadWorking={working}
      />
    </div>
  );
}

export function ThreadsMissingDetail({ onBack }: { onBack: () => void }): ReactElement {
  return (
    <div className="bg-background flex h-full min-w-0 flex-1 items-center justify-center">
      <EmptyState
        icon={Inbox}
        title="Thread no longer exists"
        description="It may have been deleted or moved out of this workspace."
      >
        <Button onClick={onBack} size="sm" variant="outline">
          Back to threads
        </Button>
      </EmptyState>
    </div>
  );
}
