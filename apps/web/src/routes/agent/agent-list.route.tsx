import { Bot, Plus, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { useVisibleAgentsQuery } from "@/domains/agent/query/agent-queries";
import { useAuth } from "@/domains/auth/use-auth";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import {
  ListPageContent,
  ListPageSearch,
  ListPageToolbar,
  ListPageToolbarSpacer,
} from "@/shared/ui/list-page";
import { PageHeader } from "@/shared/ui/page-header";
import { ScopeTabs } from "@/shared/ui/scope-tabs";
import type { Scope } from "@/shared/ui/scope-tabs";
import { ViewToggle } from "@/shared/ui/view-toggle";

import { filterAgents, getAgentsForScope, groupAgentsByScope } from "./agent-list-model";
import { mapAgentSummaryToListView } from "./agent-view.mapper";
import { AgentGrid } from "./components/agent-grid";
import { AgentTable } from "./components/agent-table";
import { CreateAgentDialog } from "./components/create-agent-dialog";
import { ImportAgentPackageDialog } from "./components/import-agent-package-dialog";

export function AgentListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeOrganization } = useAppSession();
  const [view, setView] = useState<"list" | "grid">("list");
  const [scope, setScope] = useState<Scope>("mine");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const organizationId = activeOrganization?.id ?? null;
  const agentsQuery = useVisibleAgentsQuery(organizationId);

  const agents = useMemo(
    () => (agentsQuery.data ?? []).map((profile) => mapAgentSummaryToListView(profile, user)),
    [agentsQuery.data, user],
  );

  const agentScopes = useMemo(() => groupAgentsByScope(agents), [agents]);

  const basePath = globalThis.location.pathname.startsWith("/demo") ? "/demo/agent" : "/agent";

  const scopeAgents = getAgentsForScope(agentScopes, scope);
  const filteredAgents = filterAgents(scopeAgents, search);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader title="Agents" description="Reusable workers your whole team can run.">
        <Button
          onClick={() => {
            setShowCreate(true);
          }}
          size="sm"
        >
          <Plus className="size-3.5" />
          Create agent
        </Button>
      </PageHeader>

      <ListPageToolbar>
        <ScopeTabs
          value={scope}
          onChange={setScope}
          tabs={[
            { count: agentScopes.myAgents.length, label: "Mine", value: "mine" },
            { count: agentScopes.sharedAgents.length, label: "Shared with me", value: "shared" },
          ]}
        />

        <ListPageToolbarSpacer />

        <ListPageSearch value={search} onChange={setSearch} placeholder="Search agents…" />

        <Button
          variant="outline"
          onClick={() => {
            setShowImport(true);
          }}
          size="sm"
        >
          <Upload className="size-3.5" />
          Import package
        </Button>

        <ViewToggle value={view} onChange={setView} />
      </ListPageToolbar>

      <ListPageContent>
        {agentsQuery.isLoading ? (
          <div className="text-fg-3 py-12 text-center text-[13px]">Loading agents…</div>
        ) : agentsQuery.error ? (
          <div className="text-destructive py-12 text-center text-[13px]">
            {agentsQuery.error instanceof Error
              ? agentsQuery.error.message
              : "Failed to load agents."}
          </div>
        ) : filteredAgents.length === 0 ? (
          <EmptyState
            icon={Bot}
            title={scope === "mine" ? "No agents yet" : "No agents shared with you yet"}
            description={
              scope === "mine"
                ? "Create your first agent to put a reusable worker in your team's hands."
                : "Agents shared with you by teammates will appear here."
            }
          >
            {scope === "mine" ? (
              <Button
                onClick={() => {
                  setShowCreate(true);
                }}
                size="sm"
              >
                <Plus className="size-3.5" />
                Create agent
              </Button>
            ) : null}
          </EmptyState>
        ) : view === "list" ? (
          <AgentTable
            agents={filteredAgents}
            onSelect={(id) => {
              void navigate(`${basePath}/${id}`);
            }}
            organizationId={organizationId}
            showOwner={scope === "shared"}
          />
        ) : (
          <AgentGrid
            agents={filteredAgents}
            onSelect={(id) => {
              void navigate(`${basePath}/${id}`);
            }}
            showOwner={scope === "shared"}
          />
        )}
      </ListPageContent>

      <CreateAgentDialog open={showCreate} onOpenChange={setShowCreate} />
      <ImportAgentPackageDialog
        onImportedAgentOpen={(agentId) => {
          void navigate(`${basePath}/${agentId}`);
        }}
        onOpenChange={setShowImport}
        open={showImport}
        organizationId={organizationId}
      />
    </div>
  );
}
