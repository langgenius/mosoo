import { Plus, Search, Zap } from "lucide-react";
import { Fragment, useMemo, useReducer } from "react";

import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";

import { AddMcpDialog } from "./add-mcp-dialog";
import { McpListItem } from "./mcp-list-item";
import type { McpServerWithCredential } from "./mcp-types";
import { OAuthConnectDialog } from "./oauth-connect-dialog";
import { useMcpRegistry } from "./use-mcp-registry";

interface McpTabState {
  addOpen: boolean;
  oauthServer: McpServerWithCredential | null;
  search: string;
}

type McpTabAction =
  | { type: "setAddOpen"; open: boolean }
  | { type: "setOauthServer"; server: McpServerWithCredential | null }
  | { type: "setSearch"; search: string };

const MCP_TAB_INITIAL_STATE: McpTabState = {
  addOpen: false,
  oauthServer: null,
  search: "",
};

function mcpTabReducer(state: McpTabState, action: McpTabAction): McpTabState {
  switch (action.type) {
    case "setAddOpen":
      return { ...state, addOpen: action.open };
    case "setOauthServer":
      return { ...state, oauthServer: action.server };
    case "setSearch":
      return { ...state, search: action.search };
  }
}

export function McpTab() {
  const registry = useMcpRegistry();
  const [state, dispatch] = useReducer(mcpTabReducer, MCP_TAB_INITIAL_STATE);
  const { addOpen, oauthServer, search } = state;

  const list: McpServerWithCredential[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return registry.servers;
    }
    return registry.servers.filter(
      (server) =>
        server.name.toLowerCase().includes(q) ||
        (server.description?.toLowerCase().includes(q) ?? false),
    );
  }, [registry.servers, search]);

  async function handleAddSubmit(input: {
    name: string;
    url: string;
    description?: string;
    iconUrl?: string;
    authType: "oauth" | "bearer";
    oauthClientId?: string;
    oauthClientSecret?: string;
  }) {
    const created = await registry.addServer({
      authType: input.authType,
      name: input.name,
      url: input.url,
      ...(input.description && { description: input.description }),
      ...(input.iconUrl && { iconUrl: input.iconUrl }),
      ...(input.oauthClientId && { oauthClientId: input.oauthClientId }),
      ...(input.oauthClientSecret && { oauthClientSecret: input.oauthClientSecret }),
    });
    dispatch({ server: created, type: "setOauthServer" });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="MCP servers"
        description="Extend this App with external capabilities. V1 supports Remote HTTPS only."
      >
        <Button
          onClick={() => {
            dispatch({ open: true, type: "setAddOpen" });
          }}
          size="sm"
        >
          <Plus className="size-3.5" />
          Add MCP
        </Button>
      </PageHeader>

      <div className="flex shrink-0 items-center gap-2.5 px-8 pb-4">
        <div className="relative w-[260px]">
          <Search className="text-fg-3 absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input
            placeholder="Search MCP servers..."
            value={search}
            onChange={(e) => {
              dispatch({ search: e.target.value, type: "setSearch" });
            }}
            className="h-8 pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {registry.error && (
          <div className="border-destructive/20 bg-destructive/[0.06] text-destructive mb-4 rounded-md border px-3 py-2 text-[12px]">
            {registry.error}
          </div>
        )}
        {registry.loading ? (
          <div className="text-fg-3 py-12 text-center text-[13px]">Loading MCP registry...</div>
        ) : list.length === 0 ? (
          <McpEmptyState
            searching={search.length > 0}
            onAdd={() => {
              dispatch({ open: true, type: "setAddOpen" });
            }}
          />
        ) : (
          <div className="border-border bg-card overflow-hidden rounded-lg border">
            {list.map((server, index) => (
              <Fragment key={server.id}>
                {index > 0 && <div className="bg-border-soft mx-4 h-px" />}
                <McpListItem
                  server={server}
                  onConnect={() => {
                    dispatch({ server, type: "setOauthServer" });
                  }}
                  onDelete={() => void registry.deleteServer(server.id)}
                  onRevoke={() => void registry.revokeCredential(server.id)}
                  onToggleEnabled={() => void registry.setServerEnabled(server.id, !server.enabled)}
                />
              </Fragment>
            ))}
          </div>
        )}
      </div>

      <AddMcpDialog
        open={addOpen}
        onOpenChange={(open) => {
          dispatch({ open, type: "setAddOpen" });
        }}
        onSubmit={handleAddSubmit}
      />
      <OAuthConnectDialog
        open={oauthServer !== null}
        server={oauthServer}
        onBearerConnect={async (token) =>
          oauthServer
            ? registry
                .connectBearer({
                  serverId: oauthServer.id,
                  token,
                })
                .then(() => {
                  /* Empty */
                })
            : Promise.resolve()
        }
        onConnected={async () =>
          registry.refresh().then(() => {
            /* Empty */
          })
        }
        onOpenChange={(next) => {
          if (!next) {
            dispatch({ server: null, type: "setOauthServer" });
          }
        }}
        onPollOAuthFlow={async (flowId) => registry.getOAuthFlowState(flowId)}
        onStartOAuth={async () =>
          oauthServer
            ? registry.startOAuth(oauthServer.id)
            : Promise.reject(new Error("Server missing."))
        }
      />
    </div>
  );
}

function McpEmptyState({ searching, onAdd }: { searching: boolean; onAdd: () => void }) {
  if (searching) {
    return (
      <EmptyState
        icon={Search}
        title="No matching MCP servers"
        description="Try a different search term."
      />
    );
  }

  return (
    <EmptyState
      icon={Zap}
      title="No MCP servers yet"
      description="Add an HTTPS MCP server and finish authorization to make it available to agents in this App."
    >
      <Button onClick={onAdd} size="sm">
        <Plus className="size-3.5" />
        Add MCP
      </Button>
    </EmptyState>
  );
}
