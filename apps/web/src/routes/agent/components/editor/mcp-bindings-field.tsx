import type { McpServerWithCredential as PoolServer } from "@mosoo/contracts/mcp";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useMcpRegistryQuery } from "@/domains/mcp/query/mcp-queries";
import { useTranslation } from "@/shared/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { ExternalLink, Plus, X } from "@/shared/ui/icons";

import { isTruthy } from "../../../../shared/lib/truthiness";
import { IconAvatar } from "../../../integrations/mcp/icon-avatar";
import type { McpServer } from "../../agent.types";

function toDraftMcpServer(server: PoolServer): McpServer {
  const draftServer: McpServer = {
    enabled: true,
    id: server.id,
    name: server.name,
    url: server.url,
  };

  if (isTruthy(server.iconUrl)) {
    draftServer.iconUrl = server.iconUrl;
  }

  return draftServer;
}

function McpAddDropdown({
  addedIds,
  onPick,
  open,
  onOpenChange,
  servers,
}: {
  addedIds: Set<string>;
  onPick: (server: PoolServer) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  servers: PoolServer[];
}) {
  const { t } = useTranslation();
  const availableServers = servers.filter((server) => !addedIds.has(server.id));
  const nothingLeft = availableServers.length === 0;
  const noServersAtAll = servers.length === 0;

  return (
    <DropdownMenu onOpenChange={onOpenChange} open={open}>
      <DropdownMenuTrigger asChild>
        <button
          className="text-fg-3 hover:bg-hover/30 hover:text-foreground flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-[13px] font-medium transition-colors"
          type="button"
        >
          <Plus className="size-3.5 shrink-0" />
          {t("agentEditor.addMcp")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[320px] w-[var(--anchor-width)] overflow-y-auto"
      >
        {nothingLeft ? (
          <div className="text-fg-3 p-3 text-[12px]">
            {noServersAtAll ? t("mcp.noServers") : t("mcp.allAdded")}
          </div>
        ) : (
          <>
            <DropdownMenuLabel>{t("agentEditor.projectMcp")}</DropdownMenuLabel>
            {availableServers.map((server) => (
              <McpPickerItem key={server.id} server={server} onPick={() => onPick(server)} />
            ))}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link
            className="text-fg-3 flex w-full items-center gap-1.5 text-[12px]"
            to="/integrations/mcp"
          >
            <ExternalLink className="size-3" />
            {t("agentEditor.manageMcpServers")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function McpPickerItem({ server, onPick }: { server: PoolServer; onPick(): void }) {
  return (
    <DropdownMenuItem className="gap-2 py-2" onClick={onPick}>
      <IconAvatar
        url={server.iconUrl ?? undefined}
        serverUrl={server.url}
        name={server.name}
        size={24}
      />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{server.name}</span>
      <span className="text-fg-3 shrink-0 text-[11px]">{server.ownerName}</span>
    </DropdownMenuItem>
  );
}

export function AgentMcpBindingsField({
  projectId,
  selectedServers,
  setServers,
}: {
  projectId: string | null;
  selectedServers: McpServer[];
  setServers: (servers: McpServer[]) => void;
}) {
  const { t } = useTranslation();
  const [addOpen, setAddOpen] = useState(false);
  const registryQuery = useMcpRegistryQuery(projectId);

  const poolServers = registryQuery.data?.servers ?? [];
  const poolServerById = useMemo(
    () => new Map<string, PoolServer>(poolServers.map((server) => [server.id, server])),
    [poolServers],
  );
  const addedIds = useMemo(
    () => new Set(selectedServers.map((server) => server.id)),
    [selectedServers],
  );

  function addServer(pool: PoolServer) {
    if (addedIds.has(pool.id)) {
      return;
    }

    setServers([...selectedServers, toDraftMcpServer(pool)]);
    setAddOpen(false);
  }

  function removeServer(serverId: string) {
    setServers(selectedServers.filter((server) => server.id !== serverId));
  }

  if (!isTruthy(projectId)) {
    return (
      <div className="border-border text-fg-3 rounded-lg border p-3 text-[12px]">
        {t("agentEditor.selectProjectFirst")}
      </div>
    );
  }

  if (registryQuery.error) {
    return (
      <div className="border-danger/30 text-danger rounded-lg border p-3 text-[12px]">
        {registryQuery.error instanceof Error
          ? registryQuery.error.message
          : t("agentEditor.failedToLoadMcpRegistry")}
      </div>
    );
  }

  return (
    <div className="border-border divide-border-soft divide-y overflow-hidden rounded-lg border">
      {selectedServers.map((server) => {
        const pool = poolServerById.get(server.id);
        const sourceLabel = `${t("nav.project")} · ${pool?.ownerName ?? t("agentEditor.owner")}`;

        return (
          <div
            className="group hover:bg-hover/30 flex items-center gap-3 px-3 py-2.5 transition-colors"
            key={server.id}
          >
            <IconAvatar
              url={server.iconUrl ?? undefined}
              serverUrl={server.url}
              name={server.name}
              size={36}
            />

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-foreground truncate text-[13px] font-medium">
                  {server.name}
                </span>
                <span className="text-fg-3 shrink-0 text-[10px]">{sourceLabel}</span>
              </div>
            </div>

            <button
              aria-label={t("common.remove")}
              className="text-fg-3 hover:text-danger opacity-0 transition-colors group-hover:opacity-100"
              onClick={() => removeServer(server.id)}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}

      <McpAddDropdown
        addedIds={addedIds}
        onOpenChange={setAddOpen}
        onPick={addServer}
        open={addOpen}
        servers={poolServers}
      />
    </div>
  );
}
