import type { SessionSummary } from "@mosoo/contracts/session";
import { useQuery } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { useState } from "react";

import { getAgentSessionDiagnostics } from "@/domains/session/api/agent-session-retrieve";
import { useTranslation } from "@/shared/i18n";
import { Badge } from "@/shared/ui/badge";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "@/shared/ui/icons";
import { ScrollArea } from "@/shared/ui/scroll-area";

const SESSION_DIAGNOSTICS_REFRESH_MS = 5000;

function shortId(value: string | null | undefined): string {
  if (!value) {
    return "none";
  }

  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function DiagnosticRow({ label, value }: { label: string; value: string | null }): ReactElement {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 py-1.5 text-[11px]">
      <div className="text-fg-3">{label}</div>
      <div className="text-foreground min-w-0 truncate font-mono">{value ?? "none"}</div>
    </div>
  );
}

function CountRow({ count, label }: { count: number | null; label: string }): ReactElement {
  return <DiagnosticRow label={label} value={count === null ? null : String(count)} />;
}

export function SessionDiagnosticsPanel({
  pollEvery,
  selected,
}: {
  /** The logs view's poll predicate: an interval while the run is live or settling. */
  pollEvery: (intervalMs: number) => () => number | false;
  selected: SessionSummary;
}): ReactElement {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);
  const { data, isLoading: loading } = useQuery({
    enabled: !collapsed,
    queryFn: async () =>
      getAgentSessionDiagnostics({
        projectId: selected.projectId,
        sessionId: selected.id,
      }),
    queryKey: ["agent-session-diagnostics", selected.id],
    refetchInterval: pollEvery(SESSION_DIAGNOSTICS_REFRESH_MS),
  });
  const diagnostics = data?.agentSessionDiagnostics ?? null;
  const execution = diagnostics?.execution ?? null;
  const binding = execution?.binding ?? null;
  const session = diagnostics?.session ?? null;
  // The list snapshot is polled for as long as the view is open; the
  // diagnostics snapshot stops once the run settles.
  const run = selected.lastRun ?? session?.lastRun ?? null;
  const versionNumber =
    binding?.deploymentVersionNumber ??
    session?.deploymentVersionNumber ??
    selected.deploymentVersionNumber ??
    run?.deploymentVersionNumber ??
    null;
  const deploymentVersionId =
    binding?.deploymentVersionId ??
    session?.deploymentVersionId ??
    selected.deploymentVersionId ??
    run?.deploymentVersionId ??
    null;
  const captureStatus = diagnostics !== null ? "captured" : loading ? "loading" : "waiting";

  if (collapsed) {
    return (
      <aside className="border-border-soft bg-card flex w-full shrink-0 border-t xl:w-[44px] xl:flex-col xl:border-t-0 xl:border-l">
        <button
          type="button"
          onClick={() => {
            setCollapsed(false);
          }}
          aria-label={t("agent.expandDiagnostics")}
          aria-expanded={false}
          className="text-fg-3 hover:text-foreground hover:bg-hover/40 flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors xl:flex-col xl:justify-start xl:px-0 xl:py-3"
        >
          <span className="text-foreground text-[13px] font-medium xl:hidden">Diagnostics</span>
          <ChevronUp className="size-4 xl:hidden" />
          <ChevronLeft className="hidden size-4 xl:block" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="border-border-soft bg-card flex max-h-[320px] w-full shrink-0 flex-col border-t xl:max-h-none xl:w-[360px] xl:border-t-0 xl:border-l">
      <div className="border-border-soft border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-foreground text-[13px] font-medium">Diagnostics</div>
          <div className="flex items-center gap-2">
            <Badge
              variant={diagnostics !== null ? "success" : "outline"}
              className="h-5 text-[10px]"
            >
              {captureStatus}
            </Badge>
            <button
              type="button"
              onClick={() => {
                setCollapsed(true);
              }}
              aria-label={t("agent.collapseDiagnostics")}
              aria-expanded={true}
              className="text-fg-3 hover:text-foreground hover:bg-hover/40 -mr-1 inline-flex size-5 items-center justify-center rounded transition-colors"
            >
              <ChevronDown className="size-4 xl:hidden" />
              <ChevronRight className="hidden size-4 xl:block" />
            </button>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-5 p-4">
          <section>
            <div className="t-group-label mb-2">Session snapshot</div>
            <DiagnosticRow
              label={t("agent.deployment")}
              value={
                versionNumber !== null
                  ? `v${versionNumber} - ${shortId(deploymentVersionId)}`
                  : null
              }
            />
            <DiagnosticRow
              label={t("agent.runtime")}
              value={binding?.runtimeId ?? selected.runtimeId}
            />
            <DiagnosticRow
              label={t("agent.provider")}
              value={binding?.provider ?? selected.provider}
            />
            <DiagnosticRow label={t("agent.model")} value={binding?.model ?? selected.model} />
          </section>

          <section>
            <div className="t-group-label mb-2">Run state</div>
            <DiagnosticRow label="Run" value={shortId(run?.id ?? null)} />
            <DiagnosticRow label={t("agent.status")} value={run?.status ?? selected.status} />
            <DiagnosticRow label={t("agent.trace")} value={shortId(run?.traceId ?? null)} />
          </section>

          <section>
            <div className="t-group-label mb-2">Frozen inputs</div>
            <CountRow count={execution?.skills.length ?? null} label={t("agent.skills")} />
            <CountRow count={execution?.tools.length ?? null} label="MCP" />
          </section>

          <section>
            <div className="t-group-label mb-2">Native ref</div>
            <DiagnosticRow
              label={t("agent.status")}
              value={diagnostics?.nativeRuntimeRef.status ?? null}
            />
            <DiagnosticRow
              label={t("agent.kind")}
              value={diagnostics?.nativeRuntimeRef.kind ?? null}
            />
            <DiagnosticRow
              label={t("agent.runtime")}
              value={diagnostics?.nativeRuntimeRef.runtimeId ?? null}
            />
            <DiagnosticRow
              label={t("agent.value")}
              value={diagnostics?.nativeRuntimeRef.valuePreview ?? null}
            />
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}
