import type { SessionSummary } from "@mosoo/contracts/session";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import {
  getAgentSessionProcessEvents,
  listAgentSessions,
} from "@/domains/session/api/agent-session";
import { getAgentSessionDiagnostics } from "@/domains/session/api/agent-session-retrieve";
import { toAgentId } from "@/routes/typed-id";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { SessionEventFeed } from "@/shared/ui/session-events";

import { isTruthy } from "../../../shared/lib/truthiness";
import { SessionDiagnosticsPanel } from "./session-diagnostics-panel";

const SESSION_QUERY_PARAM = "session";
const SESSION_LIST_REFRESH_MS = 5000;
const SESSION_EVENTS_REFRESH_MS = 2500;
const SESSION_DIAGNOSTICS_REFRESH_MS = 5000;

function isSessionLive(status: SessionSummary["status"]): boolean {
  return status !== "TERMINATED";
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) {
    return "just now";
  }
  if (diff < hour) {
    return `${Math.floor(diff / minute)}m ago`;
  }
  if (diff < day) {
    return `${Math.floor(diff / hour)}h ago`;
  }
  if (diff < 7 * day) {
    return `${Math.floor(diff / day)}d ago`;
  }
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function EmptyState(): ReactElement {
  return (
    <div className="bg-paper-200 flex h-full items-center justify-center px-8">
      <div className="max-w-md text-center">
        <div className="text-foreground text-[16px] font-medium">No sessions yet.</div>
        <p className="text-muted-foreground mt-2 text-[13px] leading-6">
          Once this agent runs a conversation, its runs will appear here with full transcript.
        </p>
      </div>
    </div>
  );
}

function formatRuntimeChip(session: SessionSummary): string | null {
  if (isTruthy(session.runtimeId)) {
    return session.runtimeId;
  }

  return null;
}

function getReplayTimestamp(session: SessionSummary): { label: string; value: string } {
  if (isTruthy(session.lastRun?.completedAt)) {
    return {
      label: "ended",
      value: formatRelativeTime(session.lastRun.completedAt),
    };
  }

  return {
    label: "updated",
    value: formatRelativeTime(session.updatedAt),
  };
}

function getSessionStatusVariant(
  status: SessionSummary["status"],
): "danger" | "default" | "success" | "warning" {
  switch (status) {
    case "RUNNING": {
      return "success";
    }
    case "RESCHEDULING": {
      return "warning";
    }
    case "TERMINATED": {
      return "danger";
    }
    case "IDLE": {
      return "default";
    }
    default: {
      return unreachableCase(status, "Unsupported session status.");
    }
  }
}

function getSessionTypeLabel(type: SessionSummary["type"]): string {
  switch (type) {
    case "preview": {
      return "Preview";
    }
    case "ui": {
      return "UI";
    }
    case "api_channel": {
      return "API / Channel";
    }
    default: {
      return unreachableCase(type, "Unsupported session type.");
    }
  }
}

function getSessionTypeVariant(
  type: SessionSummary["type"],
): ComponentProps<typeof Badge>["variant"] {
  switch (type) {
    case "preview": {
      return "warning";
    }
    case "ui": {
      return "primary";
    }
    case "api_channel": {
      return "outline";
    }
    default: {
      return unreachableCase(type, "Unsupported session type.");
    }
  }
}

function unreachableCase(_value: never, message: string): never {
  throw new Error(message);
}

function SessionListRow({
  session,
  onSelect,
}: {
  session: SessionSummary;
  onSelect: () => void;
}): ReactElement {
  const replay = getReplayTimestamp(session);
  const model = session.lastRun?.model ?? session.model ?? null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group grid w-full grid-cols-[minmax(0,1fr)_120px_140px_160px_120px_24px] items-center gap-4 px-4 py-3 text-left transition-colors",
        "hover:bg-paper-50",
      )}
    >
      <div className="min-w-0">
        <div className="text-foreground line-clamp-1 text-[13.5px] font-medium">
          {session.title ?? "Untitled session"}
        </div>
        <div className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px]">
          <span className="truncate font-mono" title={session.id}>
            {session.id}
          </span>
          {isTruthy(session.provider) ? (
            <span className="shrink-0">· {session.provider}</span>
          ) : null}
        </div>
      </div>
      <Badge
        variant={getSessionStatusVariant(session.status)}
        className="h-5 justify-self-start text-[10px]"
      >
        {session.status}
      </Badge>
      <span className="text-muted-foreground truncate text-[11.5px]">
        {session.runtimeId ?? "—"}
      </span>
      <span className="text-muted-foreground truncate text-[11.5px]">{model ?? "—"}</span>
      <span className="text-muted-foreground text-[11.5px]" suppressHydrationWarning>
        {replay.label} {replay.value}
      </span>
      <ChevronRight className="text-muted-foreground size-4 justify-self-end transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function SessionListView({
  sessions,
  onSelect,
}: {
  sessions: SessionSummary[];
  onSelect: (sessionId: string) => void;
}): ReactElement {
  return (
    <div className="bg-paper-200 flex h-full flex-col" data-testid="agent-diagnostics-logs">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-5xl p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-foreground text-[15px] font-semibold">Sessions</h2>
            <span className="text-muted-foreground text-[12px]">{sessions.length} total</span>
          </div>
          <div className="border-border-subtle overflow-hidden rounded-xl border bg-white">
            <div className="border-border-subtle bg-muted/30 text-fg-3 grid grid-cols-[minmax(0,1fr)_120px_140px_160px_120px_24px] gap-4 border-b px-4 py-2 text-[10.5px] font-extrabold tracking-[0.1em] uppercase">
              <span>Session</span>
              <span>Status</span>
              <span>Runtime</span>
              <span>Model</span>
              <span>Replay</span>
              <span />
            </div>
            <ul className="divide-border-soft divide-y">
              {sessions.map((session) => (
                <li key={session.id}>
                  <SessionListRow
                    session={session}
                    onSelect={() => {
                      onSelect(session.id);
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function SessionDetailView({
  selected,
  onBack,
}: {
  selected: SessionSummary;
  onBack: () => void;
}): ReactElement {
  const sessionLive = isSessionLive(selected.status);
  const processEventsQuery = useQuery({
    queryFn: async () => getAgentSessionProcessEvents(selected.id),
    queryKey: ["session-process-events", selected.id],
    refetchInterval: sessionLive ? SESSION_EVENTS_REFRESH_MS : false,
  });
  const sessionDiagnosticsQuery = useQuery({
    queryFn: async () => getAgentSessionDiagnostics({ sessionId: selected.id }),
    queryKey: ["agent-session-diagnostics", selected.id],
    refetchInterval: sessionLive ? SESSION_DIAGNOSTICS_REFRESH_MS : false,
  });
  const processEvents = processEventsQuery.data ?? [];
  const diagnostics = sessionDiagnosticsQuery.data?.agentSessionDiagnostics ?? null;
  const runtimeChip = formatRuntimeChip(selected);
  const replay = getReplayTimestamp(selected);

  return (
    <div className="bg-paper-200 flex h-full flex-col" data-testid="agent-diagnostics-logs">
      <header className="border-border-subtle border-b bg-white px-5 py-3">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label="Back to sessions"
            className="text-muted-foreground mt-0.5 -ml-1"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="text-foreground line-clamp-1 min-w-0 text-[14px] font-medium">
                {selected.title ?? "Untitled session"}
              </div>
              {runtimeChip ? (
                <span className="border-border bg-muted/40 text-fg-2 rounded-sm border px-1 py-0.5 text-[10.5px] font-semibold">
                  {runtimeChip}
                </span>
              ) : null}
              <Badge variant={getSessionTypeVariant(selected.type)}>
                {getSessionTypeLabel(selected.type)}
              </Badge>
            </div>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-[11px]">
              <span>Replay</span>
              <span>·</span>
              <span suppressHydrationWarning>
                {replay.label} {replay.value}
              </span>
              {isTruthy(selected.provider) ? (
                <>
                  <span>·</span>
                  <span>{selected.provider}</span>
                </>
              ) : null}
              {(selected.lastRun?.model ?? selected.model) ? (
                <>
                  <span>·</span>
                  <span>{selected.lastRun?.model ?? selected.model}</span>
                </>
              ) : null}
              {isTruthy(selected.deploymentVersionNumber) ? (
                <>
                  <span>·</span>
                  <span>v{selected.deploymentVersionNumber}</span>
                </>
              ) : null}
            </div>
          </div>
          <Badge variant={getSessionStatusVariant(selected.status)}>{selected.status}</Badge>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {processEventsQuery.isLoading ? (
            <div className="text-muted-foreground flex flex-1 items-center justify-center text-[13px]">
              Loading session events…
            </div>
          ) : processEventsQuery.error ? (
            <div className="text-destructive flex flex-1 items-center justify-center px-6 text-[13px]">
              {processEventsQuery.error instanceof Error
                ? processEventsQuery.error.message
                : "Failed to load session events."}
            </div>
          ) : (
            <SessionEventFeed events={processEvents} />
          )}
        </div>

        <SessionDiagnosticsPanel
          diagnostics={diagnostics}
          loading={sessionDiagnosticsQuery.isLoading}
          selected={selected}
        />
      </div>
    </div>
  );
}

export function LogsTab({ agentId }: { agentId: string }): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionParam = searchParams.get(SESSION_QUERY_PARAM);
  const sessionsQuery = useQuery({
    queryFn: async () => listAgentSessions(toAgentId(agentId)),
    queryKey: ["agent-session-list", agentId, "all"],
    refetchInterval: SESSION_LIST_REFRESH_MS,
  });
  const agentSessions = sessionsQuery.data ?? [];
  const selected =
    sessionParam === null
      ? null
      : (agentSessions.find((session) => session.id === sessionParam) ?? null);

  const navigateToSession = useCallback(
    (sessionId: string | null) => {
      setSearchParams(
        (current) => {
          const nextParams = new URLSearchParams(current);
          if (sessionId === null) {
            nextParams.delete(SESSION_QUERY_PARAM);
          } else {
            nextParams.set(SESSION_QUERY_PARAM, sessionId);
          }
          return nextParams;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const handleBack = useCallback(() => {
    navigateToSession(null);
  }, [navigateToSession]);

  const handleSelect = useCallback(
    (sessionId: string) => {
      navigateToSession(sessionId);
    },
    [navigateToSession],
  );

  if (sessionsQuery.isLoading) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-[13px]">
        Loading sessions…
      </div>
    );
  }

  if (agentSessions.length === 0) {
    return <EmptyState />;
  }

  if (selected !== null) {
    return <SessionDetailView selected={selected} onBack={handleBack} />;
  }

  return <SessionListView sessions={agentSessions} onSelect={handleSelect} />;
}
