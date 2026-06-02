import { Permission, can } from "@mosoo/contracts/permission";
import { useQuery } from "@tanstack/react-query";
import { Download, Info, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { exportAuditEvents, fetchAuditEvents } from "@/domains/audit/api/audit-client";
import type { AuditEventsInput } from "@/domains/audit/api/audit-client";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/page-header";

import { useAppSession } from "../../app/session-provider";
import { isTruthy } from "../../shared/lib/truthiness";
import { AuditEventDetail } from "./audit-event-detail";
import { AuditEventList } from "./audit-event-list";
import { AuditFilters } from "./audit-log-controls";
import { formatAuditCsvFilename, getRangeStart } from "./audit-log-model";
import type { AuditOutcome, AuditRange } from "./audit-log-model";
import { getAuditOutcome, getAuditRange } from "./audit-log-route-state";
import type { AuditSearchParamKey } from "./audit-log-route-state";

export function AuditLogPage() {
  const { activeOrganization: organization, organizationsLoading } = useAppSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const query = searchParams.get("q") ?? "";
  const range = getAuditRange(searchParams.get("range"));
  const outcome = getAuditOutcome(searchParams.get("outcome"));
  const selectedId = searchParams.get("eventId");
  const isAdmin = can(organization?.viewerRole, Permission.AuditOrganizationRead);
  const rangeStart = useMemo(() => getRangeStart(range), [range]);
  function createAuditEventsInput(): AuditEventsInput {
    const input: AuditEventsInput = {
      organizationId: organization!.id,
      startMs: rangeStart,
    };
    const q = query.trim();
    if (q) {
      input.q = q;
    }
    if (outcome !== "all") {
      input.outcome = outcome;
    }
    return input;
  }

  const auditEventsQuery = useQuery({
    enabled: isAdmin && organization !== null,
    queryFn: async () => fetchAuditEvents(createAuditEventsInput()),
    queryKey: ["audit-events", organization?.id, query.trim(), outcome, rangeStart],
  });
  const auditEvents = auditEventsQuery.data ?? [];
  const hasNonDefaultFilters = query.trim() !== "" || range !== "7d" || outcome !== "all";
  const deniedCount = auditEvents.filter((event) => event.outcome === "denied").length;

  const selected = isTruthy(selectedId)
    ? (auditEvents.find((event) => event.id === selectedId) ?? null)
    : null;

  function updateSearchParams(
    updates: Partial<Record<AuditSearchParamKey, string | null>>,
    options: { clearEvent?: boolean } = {},
  ) {
    const nextParams = new URLSearchParams(searchParams);

    for (const [key, value] of Object.entries(updates)) {
      if (!isTruthy(value)) {
        nextParams.delete(key);
      } else {
        nextParams.set(key, value);
      }
    }

    if (options.clearEvent === true) {
      nextParams.delete("eventId");
    }

    setSearchParams(nextParams, { replace: true });
  }

  function clearFilters() {
    updateSearchParams(
      {
        outcome: null,
        q: null,
        range: null,
      },
      { clearEvent: true },
    );
  }

  function setQuery(value: string) {
    updateSearchParams({ q: value }, { clearEvent: true });
  }

  function setRange(value: AuditRange) {
    updateSearchParams({ range: value }, { clearEvent: true });
  }

  function setOutcome(value: AuditOutcome) {
    updateSearchParams({ outcome: value === "all" ? null : value }, { clearEvent: true });
  }

  function setSelectedId(eventId: string | null) {
    updateSearchParams({ eventId }, { clearEvent: false });
  }

  async function handleExportCsv() {
    if (!organization || isExporting) {
      return;
    }

    setExportError(null);
    setIsExporting(true);
    try {
      const result = await exportAuditEvents(createAuditEventsInput());
      downloadBlob(result.filename ?? formatAuditCsvFilename(), result.blob);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Audit export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  if (!organization) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {organizationsLoading ? "Loading organization..." : "No organization available."}
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader className="border-border-subtle border-b py-3" title="Audit Log">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {exportError ? (
            <span className="text-destructive max-w-[280px] truncate text-[12px]">
              {exportError}
            </span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={auditEventsQuery.isFetching}
            onClick={() => void auditEventsQuery.refetch()}
          >
            <RefreshCw
              className={cn("size-3.5", auditEventsQuery.isFetching ? "animate-spin" : "")}
            />
            Refresh
          </Button>
          <Button variant="outline" size="sm" disabled={isExporting} onClick={handleExportCsv}>
            <Download className="size-3.5" />
            Export CSV
          </Button>
        </div>
      </PageHeader>

      <section className="border-border-subtle grid shrink-0 grid-cols-1 gap-3 border-b px-5 py-3 md:grid-cols-[180px_minmax(0,1fr)] md:px-8">
        <DeniedMetricCard deniedCount={deniedCount} />
        <RetentionBanner />
      </section>

      <AuditFilters
        hasNonDefaultFilters={hasNonDefaultFilters}
        onClear={clearFilters}
        outcome={outcome}
        query={query}
        range={range}
        setOutcome={setOutcome}
        setQuery={setQuery}
        setRange={setRange}
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="min-w-0 overflow-auto">
          <AuditEventList
            events={auditEvents}
            hasNonDefaultFilters={hasNonDefaultFilters}
            isLoading={auditEventsQuery.isLoading}
            isRefreshing={auditEventsQuery.isFetching}
            loadError={auditEventsQuery.error}
            onClear={clearFilters}
            onSelect={setSelectedId}
            onRetry={() => void auditEventsQuery.refetch()}
            selectedId={selected?.id ?? null}
          />
        </div>

        <aside className="border-border-subtle bg-card hidden min-h-0 overflow-y-auto border-l p-6 xl:block">
          <AuditEventDetail
            event={selected}
            onClose={() => {
              setSelectedId(null);
            }}
          />
        </aside>
      </div>

      {selected ? (
        <div className="fixed inset-0 z-40 bg-black/20 xl:hidden">
          <aside className="border-border-subtle bg-card ml-auto h-full w-full max-w-[460px] overflow-y-auto border-l p-6 shadow-lg">
            <AuditEventDetail
              event={selected}
              onClose={() => {
                setSelectedId(null);
              }}
            />
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function DeniedMetricCard({ deniedCount }: { deniedCount: number }) {
  const hasDenied = deniedCount > 0;
  return (
    <div
      className={cn(
        "border-border-subtle rounded-md border bg-card px-3 py-2",
        hasDenied ? "border-destructive/40 bg-destructive/5" : "",
      )}
    >
      <div className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
        Denied
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-2xl leading-none font-semibold tabular-nums",
          hasDenied ? "text-destructive" : "text-foreground",
        )}
      >
        {deniedCount}
      </div>
    </div>
  );
}

function RetentionBanner() {
  return (
    <div className="border-border-subtle bg-paper-200 text-fg-2 flex min-h-[68px] items-start gap-3 rounded-md border px-3 py-2 text-[13px] leading-5">
      <Info className="mt-0.5 size-4 shrink-0" />
      <p>
        Events are retained for approximately 30 days on the open-source edition. For longer
        retention, tamper-evident logs, and SIEM export, see Mosoo Cloud / Enterprise.
      </p>
    </div>
  );
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
