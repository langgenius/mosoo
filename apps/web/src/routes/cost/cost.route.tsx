import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { useState } from "react";

import { fetchAppCost } from "@/domains/cost/api/cost-client";
import type { CostRunPurpose } from "@/domains/cost/api/cost-client";
import { toAppId } from "@/routes/typed-id";

import { useAppSession } from "../../app/session-provider";
import { CostAgentsPanel } from "./cost-agents-panel";
import { rangeToInput, runPurposeToQuery } from "./cost-model";
import type { AgentCostSort, CostRange, CostTab } from "./cost-model";
import { CostModelsPanel } from "./cost-models-panel";
import { CostOverviewPanel } from "./cost-overview-panel";
import { CostPageHeader } from "./cost-page-header";
import { CostTabBar } from "./cost-tab-bar";

export function CostPage() {
  const { activeApp, appsLoading } = useAppSession();
  const [range, setRange] = useState<CostRange>("30d");
  const [activeTab, setActiveTab] = useState<CostTab>("overview");
  const [agentSort, setAgentSort] = useState<AgentCostSort>("cost_desc");
  const [runPurpose, setRunPurpose] = useState<CostRunPurpose | "all">("all");
  const runPurposes = runPurposeToQuery(runPurpose);
  const { data: card, isLoading } = useQuery({
    enabled: activeApp !== null,
    queryFn: async () => fetchAppCost(toAppId(activeApp!.id), rangeToInput(range), runPurposes),
    queryKey: ["cost", "app-card", activeApp?.id, range, runPurpose],
  });

  if (!activeApp) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {appsLoading ? "Loading app…" : "No app available."}
      </div>
    );
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

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl space-y-5">
          {isLoading ? (
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
