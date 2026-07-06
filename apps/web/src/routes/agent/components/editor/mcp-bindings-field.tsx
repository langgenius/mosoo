import type { McpServerWithCredential as PoolServer } from "@mosoo/contracts/mcp";
import { ExternalLink, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useMcpRegistryQuery } from "@/domains/mcp/query/mcp-queries";
import { cn } from "@/shared/lib/class-names";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Switch } from "@/shared/ui/switch";

import { isTruthy } from "../../../../shared/lib/truthiness";
import { IconAvatar } from "../../../integrations/mcp/icon-avatar";
import type { McpServer } from "../../agent.types";

function toDraftMcpServer(server: PoolServer): McpServer {
  const draftServer: McpServer = {
    authorizationState: server.authorizationState,
    credentialMode: "runtime_resolved",
    credentialStatus: server.credentialStatus,
    enabled: true,
    id: server.id,
    name: server.name,
    source: server.source,
    type: "web",
    url: server.url,
  };

  if (isTruthy(server.credential?.subjectLabel)) {
    draftServer.credentialSubject = server.credential.subjectLabel;
  }

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
  const availableServers = servers.filter((server) => !addedIds.has(server.id));
  const nothingLeft = availableServers.length === 0;
  const noServersAtAll = servers.length === 0;

  return (
    <DropdownMenu onOpenChange={onOpenChange} open={open}>
      <DropdownMenuTrigger asChild>
        <button
          className="text-muted-foreground hover:bg-accent/30 hover:text-foreground flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-[13px] font-medium transition-colors"
          type="button"
        >
          <Plus className="size-3.5 shrink-0" />
          Add MCP
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[320px] w-[var(--anchor-width)] overflow-y-auto"
      >
        {nothingLeft ? (
          <div className="text-muted-foreground p-3 text-[12px]">
            {noServersAtAll
              ? "No MCP servers available. Head to Manage MCP servers to add one."
              : "All available MCP servers are already added."}
          </div>
        ) : (
          <>
            <DropdownMenuLabel className="text-muted-foreground text-[10px] tracking-wider uppercase">
              App MCP
            </DropdownMenuLabel>
            {availableServers.map((server) => (
              <McpPickerItem key={server.id} server={server} onPick={() => onPick(server)} />
            ))}
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link
            className="text-muted-foreground flex w-full items-center gap-1.5 text-[12px]"
            to="/integrations/mcp"
          >
            <ExternalLink className="size-3" />
            Manage MCP servers
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
      <span className="text-muted-foreground shrink-0 text-[11px]">{server.ownerName}</span>
    </DropdownMenuItem>
  );
}

export function AgentMcpBindingsField({
  readOnly = false,
  appId,
  selectedServers,
  setServers,
}: {
  readOnly?: boolean;
  appId: string | null;
  selectedServers: McpServer[];
  setServers: (servers: McpServer[]) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const registryQuery = useMcpRegistryQuery(appId);

  const poolServers = registryQuery.data?.servers ?? [];
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

  if (!isTruthy(appId)) {
    return (
      <div className="border-border text-muted-foreground rounded-lg border p-3 text-[12px]">
        Select an App before managing MCP bindings.
      </div>
    );
  }

  if (registryQuery.error) {
    return (
      <div className="border-destructive/30 text-destructive rounded-lg border p-3 text-[12px]">
        {registryQuery.error instanceof Error
          ? registryQuery.error.message
          : "Failed to load MCP registry."}
      </div>
    );
  }

  if (selectedServers.length === 0 && readOnly) {
    return null;
  }

  return (
    <div className="border-border divide-border-subtle divide-y overflow-hidden rounded-lg border">
      {selectedServers.map((server) => {
        const pool = poolServers.find((candidate) => candidate.id === server.id);
        const sourceLabel = `App · ${pool?.ownerName ?? "Owner"}`;

        return (
          <div
            className={cn(
              "group flex items-center gap-3 px-3 py-2.5 transition-colors",
              server.enabled ? "hover:bg-accent/30" : "opacity-60 hover:bg-accent/20",
            )}
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
                <span className="text-muted-foreground shrink-0 text-[10px]">{sourceLabel}</span>
              </div>
            </div>

            <Switch checked={server.enabled} disabled />

            {!readOnly ? (
              <button
                aria-label="Remove"
                className="text-muted-foreground hover:text-destructive opacity-0 transition-colors group-hover:opacity-100"
                onClick={() => removeServer(server.id)}
                type="button"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        );
      })}

      {!readOnly ? (
        <McpAddDropdown
          addedIds={addedIds}
          onOpenChange={setAddOpen}
          onPick={addServer}
          open={addOpen}
          servers={poolServers}
        />
      ) : null}
    </div>
  );
}
