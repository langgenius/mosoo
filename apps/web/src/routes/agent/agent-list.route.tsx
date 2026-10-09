import { useMemo, useReducer } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAppSession } from "@/app/session/session-context";
import { useVisibleAgentsQuery } from "@/domains/agent/query/agent-queries";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { Bot, Plus, Upload } from "@/shared/ui/icons";
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
  showImport: boolean;
  view: "list" | "grid";
}

type AgentListPageAction =
  | { type: "setSearch"; search: string }
  | { type: "setShowImport"; open: boolean }
  | { type: "setView"; view: "list" | "grid" };

const AGENT_LIST_PAGE_INITIAL_STATE: AgentListPageState = {
  search: "",
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
    case "setShowImport":
      return { ...state, showImport: action.open };
    case "setView":
      return { ...state, view: action.view };
  }
}

export function AgentListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeProject } = useAppSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, dispatch] = useReducer(agentListPageReducer, AGENT_LIST_PAGE_INITIAL_STATE);
  const { search, showImport, view } = state;
  const projectId = activeProject?.id ?? null;
  const agentsQuery = useVisibleAgentsQuery(projectId);
  const showCreate = searchParams.get("create") === "1";

  function setShowCreate(open: boolean): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (open) {
          next.set("create", "1");
        } else {
          next.delete("create");
        }
        return next;
      },
      { replace: true },
    );
  }

  const agents = useMemo(
    () => (agentsQuery.data ?? []).map((profile) => mapAgentSummaryToListView(profile)),
    [agentsQuery.data],
  );

  const filteredAgents = filterAgents(agents, search);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title={t("agent.title")} description={t("agent.description")}>
        <Button
          disabled={projectId === null}
          onClick={() => {
            setShowCreate(true);
          }}
          size="sm"
        >
          <Plus className="size-3.5" />
          {t("agent.create")}
        </Button>
      </PageHeader>

      <ListPageToolbar>
        <ListPageSearch
          value={search}
          onChange={(nextSearch) => {
            dispatch({ search: nextSearch, type: "setSearch" });
          }}
          placeholder={t("agent.searchPlaceholder")}
        />

        <ListPageToolbarSpacer />

        <Button
          variant="outline"
          disabled={projectId === null}
          onClick={() => {
            dispatch({ open: true, type: "setShowImport" });
          }}
          size="sm"
        >
          <Upload className="size-3.5" />
          {t("agent.importPackage")}
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
          <div className="text-fg-3 py-12 text-center text-[13px]">{t("agent.loadingAgents")}</div>
        ) : agentsQuery.error ? (
          <div className="text-danger py-12 text-center text-[13px]">
            {agentsQuery.error instanceof Error
              ? agentsQuery.error.message
              : t("agent.failedToLoadAgents")}
          </div>
        ) : filteredAgents.length === 0 ? (
          <EmptyState
            icon={Bot}
            title={t("agent.noAgentsTitle")}
            description={t("agent.noAgentsDescription")}
          >
            <Button
              disabled={projectId === null}
              onClick={() => {
                setShowCreate(true);
              }}
              size="sm"
            >
              <Plus className="size-3.5" />
              {t("agent.create")}
            </Button>
          </EmptyState>
        ) : view === "list" ? (
          <AgentTable
            agents={filteredAgents}
            onSelect={(id) => {
              void navigate(`/agent/${id}`);
            }}
          />
        ) : (
          <AgentGrid
            agents={filteredAgents}
            onSelect={(id) => {
              void navigate(`/agent/${id}`);
            }}
          />
        )}
      </ListPageContent>

      <CreateAgentLauncherDialog open={showCreate} onOpenChange={setShowCreate} />
      <ImportAgentPackageDialog
        onImportedAgentOpen={(agentId) => {
          void navigate(`/agent/${agentId}`);
        }}
        onOpenChange={(open) => {
          dispatch({ open, type: "setShowImport" });
        }}
        open={showImport}
        projectId={projectId}
      />
    </div>
  );
}
