import { ExternalLink, Search, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/shared/lib/class-names";

import {
  filterCostUsers,
  formatCompactNumber,
  formatCurrency,
  formatPercent,
  sortCostUsers,
  tokensTotal,
  userCostChange,
} from "./cost-model";
import type { CostUserRow, UserCostMode, UserCostSort } from "./cost-model";

const USER_SORT_OPTIONS: { label: string; value: UserCostSort }[] = [
  { label: "Cost desc", value: "cost_desc" },
  { label: "Cost asc", value: "cost_asc" },
  { label: "Runs", value: "runs_desc" },
  { label: "Biggest spike", value: "spike_desc" },
  { label: "Top agent", value: "top_agent" },
];

export function CostUsersPanel({
  ownedUsers,
  usedUsers,
}: {
  ownedUsers: CostUserRow[];
  usedUsers: CostUserRow[];
}) {
  const [mode, setMode] = useState<UserCostMode>("used_by");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<UserCostSort>("cost_desc");
  const sourceRows = mode === "used_by" ? usedUsers : ownedUsers;
  const rows = sortCostUsers(filterCostUsers(sourceRows, query), sort);
  const agentLabel = mode === "used_by" ? "Agents used" : "Agents owned";

  return (
    <section className="border-border bg-card overflow-hidden rounded-lg border">
      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="text-muted-foreground size-4" />
          <h2 className="text-foreground text-sm font-semibold">By User</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="relative w-[220px]">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <input
              aria-label="Search user or agent"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search user or agent"
              className="border-border bg-background text-foreground h-8 w-full rounded-md border pr-2 pl-8 text-xs"
            />
          </div>
          <label className="text-muted-foreground flex items-center gap-2 text-xs font-semibold">
            Sort
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as UserCostSort);
              }}
              className="border-border bg-background text-foreground h-8 rounded-md border px-2 text-xs"
            >
              {USER_SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <div className="border-border bg-background flex rounded-md border p-0.5">
            {[
              ["used_by", "Used by"],
              ["owned_by", "Owned by"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value as UserCostMode);
                }}
                className={cn(
                  "rounded px-3 py-1 text-xs font-semibold",
                  mode === value ? "bg-accent-soft text-accent-press" : "text-muted-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="border-border bg-muted/30 text-muted-foreground grid grid-cols-[minmax(180px,1.4fr)_180px_120px_90px_110px_110px_120px] border-b px-4 py-2 text-[11px] font-semibold tracking-[0.12em] uppercase">
        <div>User</div>
        <div>Top agent</div>
        <div>{agentLabel}</div>
        <div>vs. Prev</div>
        <div>Requests</div>
        <div>Tokens</div>
        <div className="text-right">Cost</div>
      </div>

      {rows.length === 0 ? (
        <div className="text-muted-foreground px-4 py-10 text-center text-sm">
          No user cost events in this range.
        </div>
      ) : null}

      {rows.map((row) => (
        <Link
          key={row.userId}
          to={`/settings/members?member=${encodeURIComponent(row.userId)}`}
          className="border-border hover:bg-muted/40 grid grid-cols-[minmax(180px,1.4fr)_180px_120px_90px_110px_110px_120px] items-center border-b px-4 py-3 text-sm last:border-b-0"
        >
          <div className="min-w-0">
            <div className="text-foreground truncate font-semibold">{row.userName}</div>
            <div className="text-muted-foreground mt-0.5 flex items-center gap-1 truncate text-xs">
              <ExternalLink className="size-3 shrink-0" />
              <span className="truncate">{row.userEmail}</span>
            </div>
          </div>
          <div className="text-muted-foreground truncate">{row.topAgentName ?? "None"}</div>
          <div>{row.agentCount}</div>
          <UserDelta user={row} />
          <div>{formatCompactNumber(row.requestCount)}</div>
          <div>{formatCompactNumber(tokensTotal(row))}</div>
          <div className="text-right font-mono font-semibold">
            {formatCurrency(row.totalCostUsd)}
          </div>
        </Link>
      ))}
    </section>
  );
}

function UserDelta({ user }: { user: CostUserRow }) {
  const delta = userCostChange(user);

  if (delta === null) {
    return <div className="text-muted-foreground text-xs">New</div>;
  }

  return (
    <div className={cn("font-mono text-xs", delta > 0 ? "text-amber-700" : "text-green-700")}>
      {formatPercent(delta)}
    </div>
  );
}
