import { MoreHorizontal, Pencil, Trash2, Unplug } from "lucide-react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import { authTypeLabel, statusText } from "./format";
import { IconAvatar } from "./icon-avatar";
import type { McpServerWithCredential } from "./mcp-types";

interface Props {
  server: McpServerWithCredential;
  onConnect: () => void;
  onEdit: () => void;
  onRevoke: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
}

export function McpListItem({
  server,
  onConnect,
  onEdit,
  onRevoke,
  onDelete,
  onToggleEnabled,
}: Props) {
  const status = server.credentialStatus;
  const isAuthorized = status === "active";
  const metaParts = [authTypeLabel(server.authType)];
  const subjectLabel = server.credential?.subjectLabel;

  if (isAuthorized && subjectLabel !== null && subjectLabel !== undefined) {
    metaParts.push(subjectLabel);
  }

  return (
    <div
      className={cn(
        "flex items-center gap-4 px-4 py-3 transition-colors",
        "hover:bg-muted/40",
        !server.enabled && "opacity-60",
      )}
    >
      <IconAvatar
        url={server.iconUrl ?? undefined}
        serverUrl={server.url}
        name={server.name}
        size={40}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-foreground truncate text-[14px] font-medium">{server.name}</span>
          {!server.enabled && <span className="text-amber-fg shrink-0 text-[10px]">Disabled</span>}
        </div>
        {server.description && (
          <p className="text-muted-foreground mt-0.5 truncate text-[12px]">{server.description}</p>
        )}
        <p className="text-muted-foreground/80 mt-0.5 truncate text-[11px]">
          {metaParts.join(" · ")}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {isAuthorized ? (
          <span className="inline-flex items-center rounded-sm bg-green-100 px-2.5 py-0.5 text-[11px] font-bold tracking-[0.02em] text-green-800">
            {statusText("active")}
          </span>
        ) : (
          <Button onClick={onConnect} size="sm" variant="outline">
            Connect
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground size-8">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            {isAuthorized && (
              <DropdownMenuItem onClick={onRevoke}>
                <Unplug />
                Revoke credential
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onToggleEnabled}>
              {server.enabled ? "Disable" : "Enable"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
