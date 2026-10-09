import type { SessionSummary } from "@mosoo/contracts/session";
import { useQuery } from "@tanstack/react-query";
import type { ComponentProps, ReactElement } from "react";
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

import { listAgentSessions } from "@/domains/session/api/agent-session";
import { getSessionProcessEvents } from "@/domains/session/api/thread-projections";
import { toAgentId, toProjectId } from "@/routes/typed-id";
import { getCurrentLocale, useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ArrowLeft, ChevronRight } from "@/shared/ui/icons";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { SessionEventFeed } from "@/shared/ui/session-events";

import { isTruthy } from "../../../shared/lib/truthiness";
import { SessionDiagnosticsPanel } from "./session-diagnostics-panel";

const SESSION_QUERY_PARAM = "session";
const SESSION_LIST_REFRESH_MS = 5000;
const SESSION_EVENTS_REFRESH_MS = 2500;
// The session turns IDLE before its run's last output is written, and a run
// shorter than the list poll may never be listed as RUNNING, so the
// per-session polls outlive the run by this window.
const RUN_SETTLE_MS = 15_000;

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const relativeTime = new Intl.RelativeTimeFormat(getCurrentLocale(), {
    numeric: "auto",
    style: "narrow",
  });

  if (diff < minute) {
    return relativeTime.format(0, "second");
  }
  if (diff < hour) {
    return relativeTime.format(-Math.floor(diff / minute), "minute");
  }
  if (diff < day) {
    return relativeTime.format(-Math.floor(diff / hour), "hour");
  }
  if (diff < 7 * day) {
    return relativeTime.format(-Math.floor(diff / day), "day");
  }
  return new Date(iso).toLocaleDateString(getCurrentLocale(), {
    day: "numeric",
    month: "short",
  });
}

function EmptyState(): ReactElement {
  const { t } = useTranslation();

  return (
    <div className="bg-paper-200 flex h-full items-center justify-center px-8">
      <div className="max-w-md text-center">
        <div className="text-foreground text-[16px] font-medium">{t("agent.noSessionsTitle")}</div>
        <p className="text-fg-3 mt-2 text-[13px] leading-6">{t("agent.noSessionsDescription")}</p>
      </div>
    </div>
  );
}

type Translate = (key: string) => string;

function getReplayTimestamp(
  session: SessionSummary,
  t: Translate,
): { label: string; value: string } {
  if (isTruthy(session.lastRun?.completedAt)) {
    return {
      label: t("agent.sessionEnded"),
      value: formatRelativeTime(session.lastRun.completedAt),
    };
  }

  return {
    label: t("files.updated"),
    value: formatRelativeTime(session.updatedAt),
  };
}

const SESSION_STATUS_LABEL_KEYS: Record<SessionSummary["status"], string> = {
  IDLE: "agent.sessionIdle",
  RESCHEDULING: "sessionEvents.turnStatusReconnecting",
  RUNNING: "sessionEvents.turnStatusRunning",
  TERMINATED: "sessionEvents.turnStatusTerminated",
};

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

function getSessionTypeLabel(type: SessionSummary["type"], t: Translate): string {
  switch (type) {
    case "preview": {
      return t("agent.preview");
    }
    case "ui": {
      return t("agent.sessionTypeUi");
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
      return "default";
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
  const { t } = useTranslation();
  const replay = getReplayTimestamp(session, t);
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
          {session.title ?? t("agent.untitledSession")}
        </div>
        <div className="text-fg-3 mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px]">
          <span className="truncate font-mono" title={session.id}>
            {session.id}
          </span>
          {isTruthy(session.provider) ? (
            <span className="shrink-0">· {session.provider}</span>
          ) : null}
        </div>
      </div>
      <Badge variant={getSessionStatusVariant(session.status)} className="justify-self-start">
        {t(SESSION_STATUS_LABEL_KEYS[session.status])}
      </Badge>
      <span className="text-fg-3 truncate text-[11.5px]">{session.runtimeId ?? "—"}</span>
      <span className="text-fg-3 truncate text-[11.5px]">{model ?? "—"}</span>
      <span className="text-fg-3 text-[11.5px]" suppressHydrationWarning>
        {replay.label} {replay.value}
      </span>
      <ChevronRight className="text-fg-3 size-4 justify-self-end transition-transform group-hover:translate-x-0.5" />
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
  const { t } = useTranslation();

  return (
    <div className="bg-paper-200 flex h-full flex-col" data-testid="agent-diagnostics-logs">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-5xl p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-foreground text-[15px] font-semibold">
              {t("agent.sessionsHeading")}
            </h2>
            <span className="text-fg-3 text-[12px]">
              {t("agent.sessionsTotal", { count: String(sessions.length) })}
            </span>
          </div>
          <div className="border-border-soft bg-card overflow-hidden rounded-lg border">
            <div className="border-border-soft bg-sunken/30 text-fg-2 grid grid-cols-[minmax(0,1fr)_120px_140px_160px_120px_24px] gap-4 border-b px-4 py-2 text-[12px] font-medium">
              <span>{t("agent.session")}</span>
              <span>{t("agent.status")}</span>
              <span>{t("agent.runtime")}</span>
              <span>{t("agent.model")}</span>
              <span>{t("agent.replay")}</span>
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
  const { t } = useTranslation();
  // `selected` comes from the polled list, so a newly started or newly
  // finished run turns the per-session polls back on.
  const running = selected.status === "RUNNING" || selected.status === "RESCHEDULING";
  const settleUntilMs = Date.parse(selected.lastRun?.completedAt ?? "") + RUN_SETTLE_MS;
  // TanStack re-evaluates a function interval after every fetch, so each poll
  // switches itself off once the settle window closes.
  const pollEvery = (intervalMs: number) => (): number | false =>
    running || Date.now() < settleUntilMs ? intervalMs : false;
  const {
    data: processEvents = [],
    error: processEventsError,
    isLoading: processEventsLoading,
  } = useQuery({
    queryFn: async () => getSessionProcessEvents(selected.projectId, selected.id),
    queryKey: ["session-process-events", selected.id],
    refetchInterval: pollEvery(SESSION_EVENTS_REFRESH_MS),
  });
  const replay = getReplayTimestamp(selected, t);

  return (
    <div className="bg-paper-200 flex h-full flex-col" data-testid="agent-diagnostics-logs">
      <header className="border-border-soft bg-card border-b px-5 py-3">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label={t("agent.backToSessions")}
            className="text-fg-3 mt-0.5 -ml-1"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="text-foreground line-clamp-1 min-w-0 text-[14px] font-medium">
                {selected.title ?? t("agent.untitledSession")}
              </div>
              {isTruthy(selected.runtimeId) ? (
                <span className="border-border bg-sunken/40 text-fg-2 rounded-sm border px-1 py-0.5 text-[10.5px] font-semibold">
                  {selected.runtimeId}
                </span>
              ) : null}
              <Badge variant={getSessionTypeVariant(selected.type)}>
                {getSessionTypeLabel(selected.type, t)}
              </Badge>
            </div>
            <div className="text-fg-3 mt-1 flex flex-wrap items-center gap-2 text-[11px]">
              <span>{t("agent.replay")}</span>
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
          <Badge variant={getSessionStatusVariant(selected.status)}>
            {t(SESSION_STATUS_LABEL_KEYS[selected.status])}
          </Badge>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {processEventsLoading ? (
            <div className="text-fg-3 flex flex-1 items-center justify-center text-[13px]">
              {t("agent.loadingSessionEvents")}
            </div>
          ) : processEventsError ? (
            <div className="text-danger flex flex-1 items-center justify-center px-6 text-[13px]">
              {processEventsError instanceof Error
                ? processEventsError.message
                : t("agent.loadSessionEventsFailed")}
            </div>
          ) : (
            <SessionEventFeed events={processEvents} />
          )}
        </div>

        <SessionDiagnosticsPanel pollEvery={pollEvery} selected={selected} />
      </div>
    </div>
  );
}

export function LogsTab({
  agentId,
  projectId,
}: {
  agentId: string;
  projectId: string;
}): ReactElement {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionParam = searchParams.get(SESSION_QUERY_PARAM);
  const { data: agentSessions = [], isLoading } = useQuery({
    queryFn: async () => listAgentSessions(toProjectId(projectId), toAgentId(agentId)),
    queryKey: ["agent-session-list", projectId, agentId, "all"],
    refetchInterval: SESSION_LIST_REFRESH_MS,
  });
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

  if (isLoading) {
    return (
      <div className="text-fg-3 flex h-full items-center justify-center text-[13px]">
        {t("agent.loadingSessions")}
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
