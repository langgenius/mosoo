import type { SessionSummary } from "@mosoo/contracts/session";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";

import type { AgentSessionDiagnosticsQuery } from "@/gql/graphql";
import { Badge } from "@/shared/ui/badge";
import { ScrollArea } from "@/shared/ui/scroll-area";

type AgentSessionDiagnostics = AgentSessionDiagnosticsQuery["agentSessionDiagnostics"];

function shortId(value: string | null | undefined): string {
  if (!value) {
    return "none";
  }

  return value.length > 12 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;
}

function DiagnosticRow({ label, value }: { label: string; value: string | null }): ReactElement {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 py-1.5 text-[11px]">
      <div className="text-muted-foreground">{label}</div>
      <div className="text-foreground min-w-0 truncate font-mono">{value ?? "none"}</div>
    </div>
  );
}

function CountRow({ count, label }: { count: number | null; label: string }): ReactElement {
  return <DiagnosticRow label={label} value={count === null ? null : String(count)} />;
}

export function SessionDiagnosticsPanel({
  diagnostics,
  loading,
  selected,
}: {
  diagnostics: AgentSessionDiagnostics | null;
  loading: boolean;
  selected: SessionSummary;
}): ReactElement {
  const [collapsed, setCollapsed] = useState(true);
  const execution = diagnostics?.execution ?? null;
  const binding = execution?.binding ?? null;
  const session = diagnostics?.session ?? null;
  const run = session?.lastRun ?? selected.lastRun;
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
      <aside className="border-border-subtle flex w-full shrink-0 border-t bg-white xl:w-[44px] xl:flex-col xl:border-t-0 xl:border-l">
        <button
          type="button"
          onClick={() => {
            setCollapsed(false);
          }}
          aria-label="Expand diagnostics"
          aria-expanded={false}
          className="text-muted-foreground hover:text-foreground hover:bg-accent/40 flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors xl:flex-col xl:justify-start xl:px-0 xl:py-3"
        >
          <span className="text-foreground text-[13px] font-medium xl:hidden">Diagnostics</span>
          <ChevronUp className="size-4 xl:hidden" />
          <ChevronLeft className="hidden size-4 xl:block" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="border-border-subtle flex max-h-[320px] w-full shrink-0 flex-col border-t bg-white xl:max-h-none xl:w-[360px] xl:border-t-0 xl:border-l">
      <div className="border-border-subtle border-b px-4 py-3">
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
              aria-label="Collapse diagnostics"
              aria-expanded={true}
              className="text-muted-foreground hover:text-foreground hover:bg-accent/40 -mr-1 inline-flex size-5 items-center justify-center rounded transition-colors"
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
            <div className="text-muted-foreground mb-2 text-[11px] font-medium uppercase">
              Session snapshot
            </div>
            <DiagnosticRow
              label="Deployment"
              value={
                versionNumber !== null
                  ? `v${versionNumber} - ${shortId(deploymentVersionId)}`
                  : null
              }
            />
            <DiagnosticRow label="Runtime" value={binding?.runtimeId ?? selected.runtimeId} />
            <DiagnosticRow label="Provider" value={binding?.provider ?? selected.provider} />
            <DiagnosticRow label="Model" value={binding?.model ?? selected.model} />
          </section>

          <section>
            <div className="text-muted-foreground mb-2 text-[11px] font-medium uppercase">
              Run state
            </div>
            <DiagnosticRow label="Run" value={shortId(run?.id ?? null)} />
            <DiagnosticRow label="Status" value={run?.status ?? selected.status} />
            <DiagnosticRow label="Trace" value={shortId(run?.traceId ?? null)} />
            <CountRow count={diagnostics?.pendingPermissionCount ?? null} label="Permissions" />
          </section>

          <section>
            <div className="text-muted-foreground mb-2 text-[11px] font-medium uppercase">
              Frozen inputs
            </div>
            <CountRow count={execution?.skills.length ?? null} label="Skills" />
            <CountRow count={execution?.tools.length ?? null} label="MCP" />
          </section>

          <section>
            <div className="text-muted-foreground mb-2 text-[11px] font-medium uppercase">
              Native ref
            </div>
            <DiagnosticRow label="Status" value={diagnostics?.nativeRuntimeRef.status ?? null} />
            <DiagnosticRow label="Kind" value={diagnostics?.nativeRuntimeRef.kind ?? null} />
            <DiagnosticRow
              label="Runtime"
              value={diagnostics?.nativeRuntimeRef.runtimeId ?? null}
            />
            <DiagnosticRow
              label="Value"
              value={diagnostics?.nativeRuntimeRef.valuePreview ?? null}
            />
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}
