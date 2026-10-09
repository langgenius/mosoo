import type { CreateProjectMcpServerInput, McpServerWithCredential } from "@mosoo/contracts/mcp";
import { useMemo, useState } from "react";

import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { EmptyState } from "@/shared/ui/empty-state";
import { Plus, Search, Zap } from "@/shared/ui/icons";
import { Input } from "@/shared/ui/input";
import { RowList } from "@/shared/ui/list-row";
import { PageHeader } from "@/shared/ui/page-header";

import { AddMcpDialog } from "./add-mcp-dialog";
import { EditMcpDialog } from "./edit-mcp-dialog";
import { McpListItem } from "./mcp-list-item";
import { OAuthConnectDialog } from "./oauth-connect-dialog";
import { useMcpRegistry } from "./use-mcp-registry";

export function McpTab() {
  const registry = useMcpRegistry();
  const { t } = useTranslation();
  const [addOpen, setAddOpen] = useState(false);
  const [editServer, setEditServer] = useState<McpServerWithCredential | null>(null);
  const [oauthServer, setOauthServer] = useState<McpServerWithCredential | null>(null);
  const [search, setSearch] = useState("");

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

  async function handleAddSubmit(input: Omit<CreateProjectMcpServerInput, "projectId">) {
    setOauthServer(await registry.addServer(input));
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("mcp.title")} description={t("mcp.description")}>
        <Button
          onClick={() => {
            setAddOpen(true);
          }}
        >
          <Plus className="size-3.5" />
          {t("mcp.addMcp")}
        </Button>
      </PageHeader>

      <div className="flex shrink-0 items-center gap-2.5 px-4 pb-4 sm:px-8">
        <div className="relative w-full sm:w-[260px]">
          <Search className="text-fg-3 absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input
            placeholder={t("mcp.searchPlaceholder")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            className="h-8 pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-8">
        {registry.error && (
          <div
            className="border-danger/30 bg-danger-bg text-danger-fg mb-4 rounded-md border px-3 py-2 text-[13px]"
            role="alert"
          >
            {registry.error}
          </div>
        )}
        {registry.loading ? (
          <div className="text-fg-3 py-12 text-center text-[13px]">{t("mcp.loadingRegistry")}</div>
        ) : list.length === 0 ? (
          <McpEmptyState
            searching={search.length > 0}
            onAdd={() => {
              setAddOpen(true);
            }}
          />
        ) : (
          <RowList>
            {list.map((server) => (
              <McpListItem
                key={server.id}
                server={server}
                onConnect={() => {
                  setOauthServer(server);
                }}
                onEdit={() => {
                  setEditServer(server);
                }}
                onDelete={() => void registry.deleteServer(server.id)}
                onRevoke={() => void registry.revokeCredential(server.id)}
                onToggleEnabled={() => void registry.setServerEnabled(server.id, !server.enabled)}
              />
            ))}
          </RowList>
        )}
      </div>

      <AddMcpDialog open={addOpen} onOpenChange={setAddOpen} onSubmit={handleAddSubmit} />
      {editServer !== null && (
        <EditMcpDialog
          key={editServer.id}
          server={editServer}
          onOpenChange={(next) => {
            if (!next) {
              setEditServer(null);
            }
          }}
          onSubmit={async (input) => {
            await registry.updateServer({
              serverId: editServer.id,
              ...input,
            });
          }}
        />
      )}
      <OAuthConnectDialog
        open={oauthServer !== null}
        server={oauthServer}
        onBearerConnect={async (serverId, token) => registry.connectBearer({ serverId, token })}
        onConnected={registry.refresh}
        onOpenChange={(next) => {
          if (!next) {
            setOauthServer(null);
          }
        }}
        onPollOAuthFlow={registry.getOAuthFlowState}
        onStartOAuth={registry.startOAuth}
      />
    </div>
  );
}

function McpEmptyState({ searching, onAdd }: { searching: boolean; onAdd: () => void }) {
  const { t } = useTranslation();

  if (searching) {
    return (
      <EmptyState
        icon={Search}
        title={t("mcp.noMatchingTitle")}
        description={t("mcp.noMatchingDescription")}
      />
    );
  }

  return (
    <EmptyState
      icon={Zap}
      title={t("mcp.noServersTitle")}
      description={t("mcp.noServersDescription")}
    >
      <Button onClick={onAdd}>
        <Plus className="size-3.5" />
        {t("mcp.addMcp")}
      </Button>
    </EmptyState>
  );
}
