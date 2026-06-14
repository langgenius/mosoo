import { Permission, can } from "@mosoo/contracts/permission";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { fetchOrganizationCost } from "@/domains/cost/api/cost-client";
import type { CostRunPurpose } from "@/domains/cost/api/cost-client";

import { useAppSession } from "../../app/session-provider";
import { CostAgentsPanel } from "./cost-agents-panel";
import { rangeToInput } from "./cost-model";
import type { AgentCostSort, CostRange, CostTab } from "./cost-model";
import { CostModelsPanel } from "./cost-models-panel";
import { CostOverviewPanel } from "./cost-overview-panel";
import { CostPageHeader } from "./cost-page-header";
import { CostTabBar } from "./cost-tab-bar";
import { CostUsersPanel } from "./cost-usage-panel";

function AdminOnlyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="bg-muted text-muted-foreground mb-3 flex size-10 items-center justify-center rounded-lg">
        <BarChart3 className="size-5" />
      </div>
      <h1 className="text-foreground text-lg font-semibold">Admins only</h1>
      <p className="text-muted-foreground mt-2 max-w-md text-sm">
        Workspace Cost is available to organization admins. You can still review your own usage in
        Settings.
      </p>
      <Link
        to="/settings/usage"
        className="border-border hover:bg-muted mt-4 rounded-md border px-3 py-2 text-sm font-semibold"
      >
        Open Settings Usage
      </Link>
    </div>
  );
}

export function CostPage() {
  const { activeOrganization: organization, organizationsLoading } = useAppSession();
  const [range, setRange] = useState<CostRange>("30d");
  const [activeTab, setActiveTab] = useState<CostTab>("overview");
  const [agentSort, setAgentSort] = useState<AgentCostSort>("cost_desc");
  const [runPurpose, setRunPurpose] = useState<CostRunPurpose | "all">("all");
  const isAdmin = can(organization?.viewerRole, Permission.CostOrganizationRead);
  const runPurposes = runPurpose === "all" ? [] : [runPurpose];
  const costQuery = useQuery({
    enabled: isAdmin && organization !== null,
    queryFn: async () => fetchOrganizationCost(organization!.id, rangeToInput(range), runPurposes),
    queryKey: ["cost", "organization-card", organization?.id, range, runPurpose],
  });
  const card = costQuery.data;

  if (!organization) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {organizationsLoading ? "Loading organization…" : "No organization available."}
      </div>
    );
  }

  if (!isAdmin) {
    return <AdminOnlyState />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <CostPageHeader
        card={card}
        effectiveTab={activeTab}
        range={range}
        runPurpose={runPurpose}
        setRange={setRange}
        setRunPurpose={setRunPurpose}
      />
      <CostTabBar effectiveTab={activeTab} setActiveTab={setActiveTab} />

      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-6xl space-y-5">
          {costQuery.isLoading ? (
            <div className="border-border bg-card text-muted-foreground rounded-lg border px-4 py-10 text-center text-sm">
              Loading cost data…
            </div>
          ) : null}

          {activeTab === "overview" ? (
            <CostOverviewPanel card={card} range={range} setActiveTab={setActiveTab} />
          ) : null}
          {activeTab === "agents" ? (
            <CostAgentsPanel agents={card?.agents ?? []} setSort={setAgentSort} sort={agentSort} />
          ) : null}
          {activeTab === "users" ? (
            <CostUsersPanel ownedUsers={card?.ownerUsers ?? []} usedUsers={card?.users ?? []} />
          ) : null}
          {activeTab === "models" ? <CostModelsPanel models={card?.models ?? []} /> : null}

          <div className="border-border bg-card text-muted-foreground flex items-center gap-2 rounded-lg border px-4 py-3 text-xs">
            <BarChart3 className="size-3.5" />
            Costs use cache-adjusted input tokens: billable input = max(0, input - cache read).
          </div>
        </div>
      </main>
    </div>
  );
}
