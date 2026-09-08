import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Check, MoreHorizontal, Pencil, Power, PowerOff, Trash2, Unplug } from "@/shared/ui/icons";
import { ConnectionRow } from "@/shared/ui/list-row";

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

// One 44px connection row per server (docs/design/console-design-contract.md,
// section 4): mark, name plus a single meta line, then the state. Authorized
// is a success badge with a glyph; a server that still needs authorization
// shows the Connect action instead of a status; a disabled server keeps
// legible text and says so with a badge rather than fading the row.
export function McpListItem({
  server,
  onConnect,
  onEdit,
  onRevoke,
  onDelete,
  onToggleEnabled,
}: Props) {
  const { t } = useTranslation();
  const status = server.credentialStatus;
  const isAuthorized = status === "active";
  const metaParts = [authTypeLabel(server.authType, t)];
  const subjectLabel = server.credential?.subjectLabel;

  if (isAuthorized && subjectLabel !== null && subjectLabel !== undefined) {
    metaParts.push(subjectLabel);
  }
  if (server.description) {
    metaParts.unshift(server.description);
  }

  return (
    <ConnectionRow interactive className="px-4">
      <IconAvatar
        url={server.iconUrl ?? undefined}
        serverUrl={server.url}
        name={server.name}
        size={32}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-[13px] font-medium",
              server.enabled ? "text-fg-heading" : "text-fg-3",
            )}
          >
            {server.name}
          </span>
          {server.enabled ? null : (
            <Badge variant="pending">
              <PowerOff />
              {t("mcp.disabled")}
            </Badge>
          )}
        </div>
        <p className="text-fg-3 mt-0.5 truncate text-[12px] leading-4">{metaParts.join(" · ")}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {isAuthorized ? (
          <Badge variant="success">
            <Check />
            {statusText("active", t)}
          </Badge>
        ) : (
          <Button disabled={!server.enabled} onClick={onConnect} size="sm" variant="outline">
            {t("mcp.connect")}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label={t("mcp.serverActions")} variant="ghost" size="icon-sm">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil />
              {t("common.edit")}
            </DropdownMenuItem>
            {isAuthorized && (
              <DropdownMenuItem onClick={onRevoke}>
                <Unplug />
                {t("mcp.revokeCredential")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onToggleEnabled}>
              {server.enabled ? <PowerOff /> : <Power />}
              {server.enabled ? t("mcp.disable") : t("mcp.enable")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onDelete} variant="destructive">
              <Trash2 />
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </ConnectionRow>
  );
}
