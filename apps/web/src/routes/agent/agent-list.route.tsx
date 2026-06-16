import { Bot, Plus, Upload } from "lucide-react";
import { useEffect, useMemo, useReducer } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

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
import { ViewToggle } from "@/shared/ui/view-toggle";

import { filterAgents } from "./agent-list-model";
import { mapAgentSummaryToListView } from "./agent-view.mapper";
import { AgentGrid } from "./components/agent-grid";
import { AgentTable } from "./components/agent-table";
import { CreateAgentLauncherDialog } from "./components/create-agent-launcher";
import { ImportAgentPackageDialog } from "./components/import-agent-package-dialog";

interface AgentListPageState {
  search: string;
  showCreate: boolean;
  showImport: boolean;
  view: "list" | "grid";
}

type AgentListPageAction =
  | { type: "setSearch"; search: string }
  | { type: "setShowCreate"; open: boolean }
  | { type: "setShowImport"; open: boolean }
  | { type: "setView"; view: "list" | "grid" };

const AGENT_LIST_PAGE_INITIAL_STATE: AgentListPageState = {
  search: "",
  showCreate: false,
  showImport: false,
  view: "list",
};

function agentListPageReducer(
  state: AgentListPageState,
  action: AgentListPageAction,
): AgentListPageState {
  switch (action.type) {
    case "setSearch":
      return { ...state, search: action.search };
    case "setShowCreate":
      return { ...state, showCreate: action.open };
    case "setShowImport":
      return { ...state, showImport: action.open };
    case "setView":
      return { ...state, view: action.view };
  }
}

export function AgentListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeApp } = useAppSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, dispatch] = useReducer(agentListPageReducer, AGENT_LIST_PAGE_INITIAL_STATE);
  const { search, showCreate, showImport, view } = state;
  const appId = activeApp?.id ?? null;
  const agentsQuery = useVisibleAgentsQuery(appId);

  useEffect(() => {
    if (searchParams.get("create") !== "1") return;
    dispatch({ open: true, type: "setShowCreate" });
    const next = new URLSearchParams(searchParams);
    next.delete("create");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const agents = useMemo(
    () => (agentsQuery.data ?? []).map((profile) => mapAgentSummaryToListView(profile, user)),
    [agentsQuery.data, user],
  );

  const basePath = globalThis.location.pathname.startsWith("/demo") ? "/demo/agent" : "/agent";

  const filteredAgents = filterAgents(agents, search);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader title="Agents" description="Reusable workers for this App.">
        <Button
          disabled={appId === null}
          onClick={() => {
            dispatch({ open: true, type: "setShowCreate" });
          }}
          size="sm"
        >
          <Plus className="size-3.5" />
          Create agent
        </Button>
      </PageHeader>

      <ListPageToolbar>
        <ListPageSearch
          value={search}
          onChange={(nextSearch) => {
            dispatch({ search: nextSearch, type: "setSearch" });
          }}
          placeholder="Search agents…"
        />

        <ListPageToolbarSpacer />

        <Button
          variant="outline"
          disabled={appId === null}
          onClick={() => {
            dispatch({ open: true, type: "setShowImport" });
          }}
          size="sm"
        >
          <Upload className="size-3.5" />
          Import package
        </Button>

        <ViewToggle
          value={view}
          onChange={(nextView) => {
            dispatch({ type: "setView", view: nextView });
          }}
        />
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
            title="No agents yet"
            description="Create your first agent for this App."
          >
            <Button
              disabled={appId === null}
              onClick={() => {
                dispatch({ open: true, type: "setShowCreate" });
              }}
              size="sm"
            >
              <Plus className="size-3.5" />
              Create agent
            </Button>
          </EmptyState>
        ) : view === "list" ? (
          <AgentTable
            agents={filteredAgents}
            onSelect={(id) => {
              void navigate(`${basePath}/${id}`);
            }}
            showOwner={false}
          />
        ) : (
          <AgentGrid
            agents={filteredAgents}
            onSelect={(id) => {
              void navigate(`${basePath}/${id}`);
            }}
            showOwner={false}
          />
        )}
      </ListPageContent>

      <CreateAgentLauncherDialog
        open={showCreate}
        onOpenChange={(open) => {
          dispatch({ open, type: "setShowCreate" });
        }}
      />
      <ImportAgentPackageDialog
        onImportedAgentOpen={(agentId) => {
          void navigate(`${basePath}/${agentId}`);
        }}
        onOpenChange={(open) => {
          dispatch({ open, type: "setShowImport" });
        }}
        open={showImport}
        appId={appId}
      />
    </div>
  );
}
