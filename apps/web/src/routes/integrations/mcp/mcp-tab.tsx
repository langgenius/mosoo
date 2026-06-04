import { Plus, Search, Shield, Zap } from "lucide-react";
import { Fragment, useMemo, useReducer } from "react";

import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/page-header";
import { ScopeTabs } from "@/shared/ui/scope-tabs";
import type { Scope } from "@/shared/ui/scope-tabs";

import { AddMcpDialog } from "./add-mcp-dialog";
import { HostOrganizationMcpDialog } from "./host-organization-mcp-dialog";
import type { HostOrganizationMcpInput } from "./host-organization-mcp-dialog";
import { McpListItem } from "./mcp-list-item";
import type { McpServerWithCredential, McpViewMode } from "./mcp-types";
import { OAuthConnectDialog } from "./oauth-connect-dialog";
import { ServiceAccountCredentialDialog } from "./service-account-credential-dialog";
import { useMcpRegistry } from "./use-mcp-registry";

function scopeToView(scope: Scope): McpViewMode {
  if (scope === "mine") {
    return "personal";
  }
  if (scope === "shared") {
    return "shared";
  }
  return "managed";
}

interface McpTabState {
  addOpen: boolean;
  hostOpen: boolean;
  oauthServer: McpServerWithCredential | null;
  scope: Scope;
  search: string;
  serviceAccountServer: McpServerWithCredential | null;
}

type McpTabAction =
  | { type: "setAddOpen"; open: boolean }
  | { type: "setHostOpen"; open: boolean }
  | { type: "setOauthServer"; server: McpServerWithCredential | null }
  | { type: "setScope"; scope: Scope }
  | { type: "setSearch"; search: string }
  | { type: "setServiceAccountServer"; server: McpServerWithCredential | null };

const MCP_TAB_INITIAL_STATE: McpTabState = {
  addOpen: false,
  hostOpen: false,
  oauthServer: null,
  scope: "mine",
  search: "",
  serviceAccountServer: null,
};

function mcpTabReducer(state: McpTabState, action: McpTabAction): McpTabState {
  switch (action.type) {
    case "setAddOpen":
      return { ...state, addOpen: action.open };
    case "setHostOpen":
      return { ...state, hostOpen: action.open };
    case "setOauthServer":
      return { ...state, oauthServer: action.server };
    case "setScope":
      return { ...state, scope: action.scope };
    case "setSearch":
      return { ...state, search: action.search };
    case "setServiceAccountServer":
      return { ...state, serviceAccountServer: action.server };
  }
}

export function McpTab() {
  const registry = useMcpRegistry();
  const [state, dispatch] = useReducer(mcpTabReducer, MCP_TAB_INITIAL_STATE);
  const { addOpen, hostOpen, oauthServer, scope, search, serviceAccountServer } = state;

  const effectiveScope: Scope = !registry.isAdmin && scope === "organization" ? "mine" : scope;
  const active: McpViewMode = scopeToView(effectiveScope);

  const list: McpServerWithCredential[] = useMemo(() => {
    const base = active === "personal" ? registry.personal : registry.organizationShared;
    const q = search.trim().toLowerCase();
    if (!q) {
      return base;
    }
    return base.filter(
      (s) =>
        s.name.toLowerCase().includes(q) || (s.description?.toLowerCase().includes(q) ?? false),
    );
  }, [active, registry.personal, registry.organizationShared, search]);

  function handleConnect(server: McpServerWithCredential) {
    if (server.credentialScope === "organization_shared" && server.hasSharedCredential) {
      return;
    }
    dispatch({ server, type: "setOauthServer" });
  }

  async function handleAddSubmit(input: {
    name: string;
    url: string;
    description?: string;
    iconUrl?: string;
    authType: "oauth" | "bearer";
    oauthClientId?: string;
    oauthClientSecret?: string;
  }) {
    const created = await registry.addPersonalServer({
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

  async function handleHostSubmit(input: HostOrganizationMcpInput) {
    await registry.addOrganizationServer({
      authType: input.authType,
      credentialScope: input.credentialScope,
      name: input.name,
      url: input.url,
      ...(input.description && { description: input.description }),
      ...(input.iconUrl && { iconUrl: input.iconUrl }),
      ...(input.sharedBearerToken && {
        sharedBearerToken: input.sharedBearerToken,
      }),
      ...(input.oauthClientId && { oauthClientId: input.oauthClientId }),
      ...(input.oauthClientSecret && { oauthClientSecret: input.oauthClientSecret }),
    });
  }

  const showAddButton = active === "personal";
  const showHostButton = active === "managed" && registry.isAdmin;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="MCP servers"
        description="Extend Agents with external capabilities. V1 supports Remote HTTPS only."
      >
        {showAddButton ? (
          <Button
            onClick={() => {
              dispatch({ open: true, type: "setAddOpen" });
            }}
            size="sm"
          >
            <Plus className="size-3.5" />
            Add MCP
          </Button>
        ) : showHostButton ? (
          <Button
            onClick={() => {
              dispatch({ open: true, type: "setHostOpen" });
            }}
            size="sm"
          >
            <Plus className="size-3.5" />
            Host organization MCP
          </Button>
        ) : null}
      </PageHeader>

      <div className="flex shrink-0 items-center gap-2.5 px-8 pb-4">
        <ScopeTabs
          value={effectiveScope}
          onChange={(nextScope) => {
            dispatch({ scope: nextScope, type: "setScope" });
          }}
          tabs={[
            { count: registry.personal.length, label: "Mine", value: "mine" },
            {
              count: registry.organizationShared.length,
              label: "Shared with me",
              value: "shared",
            },
            {
              count: registry.organizationShared.length,
              label: "All organization",
              value: "organization",
              visible: registry.isAdmin,
            },
          ]}
        />

        <div className="flex-1" />

        <div className="relative w-[260px]">
          <Search className="text-fg-3 absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input
            placeholder="Search MCP servers…"
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
          <div className="text-fg-3 py-12 text-center text-[13px]">Loading MCP registry…</div>
        ) : list.length === 0 ? (
          <McpEmptyState
            kind={active}
            searching={search.length > 0}
            onAdd={() => {
              dispatch({ open: true, type: "setAddOpen" });
            }}
            onHost={() => {
              dispatch({ open: true, type: "setHostOpen" });
            }}
          />
        ) : (
          <div className="border-border bg-card overflow-hidden rounded-lg border">
            {list.map((s, idx) => {
              const canDelete = active === "personal" || (active === "managed" && registry.isAdmin);
              return (
                <Fragment key={s.id}>
                  {idx > 0 && <div className="bg-border-soft mx-4 h-px" />}
                  <McpListItem
                    server={s}
                    mode={active}
                    onConnect={() => {
                      handleConnect(s);
                    }}
                    {...(s.credentialScope === "organization_shared" &&
                      active === "managed" &&
                      registry.isAdmin && {
                        onClearSharedCredential: () =>
                          void registry.clearOrganizationSharedCredential(s.id),
                        onConfigureSharedCredential: () => {
                          dispatch({ server: s, type: "setServiceAccountServer" });
                        },
                      })}
                    onRevoke={() => void registry.revokeCredential(s.id)}
                    {...(canDelete && {
                      onDelete: () => void registry.deleteServer(s.id),
                    })}
                    {...(active === "managed" &&
                      registry.isAdmin && {
                        onToggleEnabled: () => void registry.setServerEnabled(s.id, !s.enabled),
                      })}
                  />
                </Fragment>
              );
            })}
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
      <HostOrganizationMcpDialog
        open={hostOpen}
        onOpenChange={(open) => {
          dispatch({ open, type: "setHostOpen" });
        }}
        onSubmit={handleHostSubmit}
      />
      <ServiceAccountCredentialDialog
        open={serviceAccountServer !== null}
        server={serviceAccountServer}
        onOpenChange={(next) => {
          if (!next) {
            dispatch({ server: null, type: "setServiceAccountServer" });
          }
        }}
        onSubmit={async (input) =>
          serviceAccountServer
            ? registry
                .setOrganizationSharedCredential({
                  serverId: serviceAccountServer.id,
                  token: input.token,
                  ...(input.subjectLabel && { subjectLabel: input.subjectLabel }),
                })
                .then(() => {
                  /* Empty */
                })
            : Promise.resolve()
        }
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

function McpEmptyState({
  kind,
  searching,
  onAdd,
  onHost,
}: {
  kind: McpViewMode;
  searching: boolean;
  onAdd: () => void;
  onHost: () => void;
}) {
  if (searching) {
    return (
      <EmptyState
        icon={Search}
        title="No matching MCP servers"
        description="Try a different search term."
      />
    );
  }
  if (kind === "personal") {
    return (
      <EmptyState
        icon={Zap}
        title="No personal MCP servers yet"
        description="Add an HTTPS MCP server and finish authorization to make it available to agents."
      >
        <Button onClick={onAdd} size="sm">
          <Plus className="size-3.5" />
          Add MCP
        </Button>
      </EmptyState>
    );
  }
  if (kind === "shared") {
    return (
      <EmptyState
        icon={Zap}
        title="No organization MCP servers yet"
        description="MCP servers hosted for this organization will appear here."
      />
    );
  }
  return (
    <EmptyState
      icon={Shield}
      title="Host organization MCP"
      description="Host one Remote HTTPS MCP server for the whole organization. Choose per-user authorization or a shared service account credential."
    >
      <Button onClick={onHost} size="sm">
        <Plus className="size-3.5" />
        Host MCP
      </Button>
    </EmptyState>
  );
}
