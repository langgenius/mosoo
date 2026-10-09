import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useActiveProject } from "@/app/session/session-context";
import { fetchProjectCost } from "@/domains/cost/api/cost-client";
import type { CostRunPurpose } from "@/domains/cost/api/cost-client";
import { useTranslation } from "@/shared/i18n";
import { BarChart3 } from "@/shared/ui/icons";

import { CostAgentsPanel } from "./cost-agents-panel";
import { rangeToInput, runPurposeToQuery } from "./cost-model";
import type { AgentCostSort, CostRange, CostTab } from "./cost-model";
import { CostModelsPanel } from "./cost-models-panel";
import { CostOverviewPanel } from "./cost-overview-panel";
import { CostPageHeader } from "./cost-page-header";
import { CostTabBar } from "./cost-tab-bar";

export function CostPage() {
  const { t } = useTranslation();
  const project = useActiveProject();
  const [range, setRange] = useState<CostRange>("30d");
  const [activeTab, setActiveTab] = useState<CostTab>("overview");
  const [agentSort, setAgentSort] = useState<AgentCostSort>("cost_desc");
  const [runPurpose, setRunPurpose] = useState<CostRunPurpose | "all">("all");
  const runPurposes = runPurposeToQuery(runPurpose);
  const { data: card, isLoading } = useQuery({
    queryFn: async () => fetchProjectCost(project.id, rangeToInput(range), runPurposes),
    queryKey: ["cost", "project-card", project.id, range, runPurpose],
  });

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

      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-6xl space-y-5">
          {isLoading ? (
            <div className="border-border bg-card text-fg-3 rounded-lg border px-4 py-10 text-center text-sm">
              {t("common.loadingCost")}
            </div>
          ) : null}

          {activeTab === "overview" ? (
            <CostOverviewPanel card={card} range={range} setActiveTab={setActiveTab} />
          ) : null}
          {activeTab === "agents" ? (
            <CostAgentsPanel agents={card?.agents ?? []} setSort={setAgentSort} sort={agentSort} />
          ) : null}
          {activeTab === "models" ? <CostModelsPanel models={card?.models ?? []} /> : null}

          <div className="border-border bg-card text-fg-3 flex items-center gap-2 rounded-lg border px-4 py-3 text-xs">
            <BarChart3 className="size-3.5" />
            {t("cost.cacheNote")}
          </div>
        </div>
      </main>
    </div>
  );
}
