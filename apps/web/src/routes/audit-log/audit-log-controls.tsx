import { Search } from "lucide-react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import { AUDIT_RANGES } from "./audit-log-model";
import type { AuditOutcome, AuditRange } from "./audit-log-model";

export function AuditFilters({
  hasNonDefaultFilters,
  onClear,
  outcome,
  query,
  range,
  setOutcome,
  setQuery,
  setRange,
}: {
  hasNonDefaultFilters: boolean;
  onClear: () => void;
  outcome: AuditOutcome;
  query: string;
  range: AuditRange;
  setOutcome: (outcome: AuditOutcome) => void;
  setQuery: (query: string) => void;
  setRange: (range: AuditRange) => void;
}) {
  return (
    <section className="border-border-subtle flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-2 md:px-8">
      <div className="relative w-full min-w-0 sm:w-auto sm:min-w-[260px]">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search actor, action, resource..."
          className="h-8 pl-8"
        />
      </div>
      <div className="border-border bg-card flex rounded-md border p-0.5">
        {AUDIT_RANGES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setRange(value);
            }}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-semibold",
              range === value ? "bg-accent-soft text-accent-press" : "text-muted-foreground",
            )}
          >
            {value}
          </button>
        ))}
      </div>
      <select
        value={outcome}
        onChange={(event) => {
          setOutcome(event.target.value as AuditOutcome);
        }}
        className="border-border bg-background h-8 rounded-md border px-3 text-sm"
      >
        <option value="all">All outcomes</option>
        <option value="success">Success</option>
        <option value="failure">Failure</option>
        <option value="denied">Denied</option>
      </select>
      {hasNonDefaultFilters ? (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </section>
  );
}
