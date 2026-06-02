import { KeyRound, MoreHorizontal, Plug, Shield, Trash2, Unplug, Users } from "lucide-react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import { authTypeLabel, credentialScopeLabel, statusText } from "./format";
import { IconAvatar } from "./icon-avatar";
import type { McpServerWithCredential, McpViewMode } from "./mcp-types";

interface Props {
  server: McpServerWithCredential;
  mode: McpViewMode;
  onConnect: () => void;
  onConfigureSharedCredential?: () => void;
  onClearSharedCredential?: () => void;
  onRevoke: () => void;
  onDelete?: () => void;
  onToggleEnabled?: () => void;
}

export function McpListItem({
  server,
  mode,
  onConnect,
  onConfigureSharedCredential,
  onClearSharedCredential,
  onRevoke,
  onDelete,
  onToggleEnabled,
}: Props) {
  const status = server.credentialStatus;
  const isAuthorized = status === "active";
  const isServiceAccount =
    server.credentialScope === "organization_shared" && server.hasSharedCredential;
  const isWaitingForAdminConfig =
    mode === "shared" &&
    server.credentialScope === "organization_shared" &&
    !server.hasSharedCredential;

  // Subtitle metadata: auth + source + (subject)
  const metaParts: string[] = [];
  metaParts.push(authTypeLabel(server.authType));
  if (server.source === "organization_shared") {
    metaParts.push(`Organization · ${server.ownerName}`);
  } else if (mode === "personal") {
    metaParts.push("Personal");
  }
  if (isServiceAccount) {
    metaParts.push("Managed by admin");
  } else {
    const subjectLabel = server.credential?.subjectLabel;
    if (isAuthorized && subjectLabel !== null && subjectLabel !== undefined) {
      metaParts.push(subjectLabel);
    }
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
          {/* Credential scope badge — only shown on shared tab for clarity */}
          {mode === "shared" && server.source === "organization_shared" && (
            <ScopeBadge scope={server.credentialScope} serviceAccountReady={isServiceAccount} />
          )}
          {!server.enabled && <span className="shrink-0 text-[10px] text-amber-600">Disabled</span>}
        </div>
        {server.description && (
          <p className="text-muted-foreground mt-0.5 truncate text-[12px]">{server.description}</p>
        )}
        <p className="text-muted-foreground/80 mt-0.5 truncate text-[11px]">
          {metaParts.join(" · ")}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {mode === "managed" ? (
          <ManagedActions
            hasSharedCredential={isServiceAccount}
            credentialScope={server.credentialScope}
            enabled={server.enabled}
            {...(onConfigureSharedCredential && { onConfigureSharedCredential })}
            {...(onClearSharedCredential && { onClearSharedCredential })}
            {...(onToggleEnabled && { onToggleEnabled })}
            {...(onDelete && { onDelete })}
          />
        ) : isWaitingForAdminConfig ? (
          <WaitingForAdminActions />
        ) : isAuthorized ? (
          <ActiveActions
            isServiceAccount={isServiceAccount}
            mode={mode}
            onRevoke={onRevoke}
            {...(mode === "personal" && onDelete && { onDelete })}
          />
        ) : (
          <PendingActions
            mode={mode}
            onConnect={onConnect}
            {...(mode === "personal" && onDelete && { onDelete })}
          />
        )}
      </div>
    </div>
  );
}

function WaitingForAdminActions() {
  return (
    <span className="bg-paper-200 text-fg-2 inline-flex items-center rounded-sm px-2.5 py-0.5 text-[11px] font-bold tracking-[0.02em]">
      Waiting for admin setup
    </span>
  );
}

function ScopeBadge({
  scope,
  serviceAccountReady,
}: {
  scope: McpServerWithCredential["credentialScope"];
  serviceAccountReady: boolean;
}) {
  if (scope === "organization_shared") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold tracking-[0.02em] shrink-0",
          serviceAccountReady ? "bg-amber/15 text-[#8a6318]" : "bg-paper-200 text-fg-2",
        )}
      >
        <Shield className="size-2.5" />
        {credentialScopeLabel("organization_shared")}
      </span>
    );
  }
  return (
    <span className="bg-paper-200 text-fg-2 inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-bold tracking-[0.02em]">
      <Users className="size-2.5" />
      {credentialScopeLabel("user")}
    </span>
  );
}

function ManagedActions({
  hasSharedCredential,
  credentialScope,
  enabled,
  onConfigureSharedCredential,
  onClearSharedCredential,
  onToggleEnabled,
  onDelete,
}: {
  hasSharedCredential: boolean;
  credentialScope: McpServerWithCredential["credentialScope"];
  enabled: boolean;
  onConfigureSharedCredential?: () => void;
  onClearSharedCredential?: () => void;
  onToggleEnabled?: () => void;
  onDelete?: () => void;
}) {
  return (
    <>
      <span className="text-muted-foreground mr-1 shrink-0 text-[10px]">
        {credentialScope === "organization_shared"
          ? hasSharedCredential
            ? "Service account ready"
            : "Service account missing"
          : "per-user"}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="text-muted-foreground size-8">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {credentialScope === "organization_shared" && onConfigureSharedCredential && (
            <DropdownMenuItem onClick={onConfigureSharedCredential}>
              <KeyRound />
              {hasSharedCredential ? "Replace service account" : "Set service account"}
            </DropdownMenuItem>
          )}
          {credentialScope === "organization_shared" &&
            hasSharedCredential &&
            onClearSharedCredential && (
              <DropdownMenuItem onClick={onClearSharedCredential}>
                <Unplug />
                Clear service account
              </DropdownMenuItem>
            )}
          {credentialScope === "organization_shared" && <DropdownMenuSeparator />}
          {onToggleEnabled && (
            <DropdownMenuItem onClick={onToggleEnabled}>
              {enabled ? "Disable" : "Enable"}
            </DropdownMenuItem>
          )}
          {onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function ActiveActions({
  isServiceAccount,
  mode,
  onRevoke,
  onDelete,
}: {
  isServiceAccount: boolean;
  mode: McpViewMode;
  onRevoke: () => void;
  onDelete?: () => void;
}) {
  return (
    <>
      <span className="inline-flex items-center rounded-sm bg-green-100 px-2.5 py-0.5 text-[11px] font-bold tracking-[0.02em] text-green-800">
        {statusText("active")}
      </span>
      {/* Service Account: Members cannot revoke Admin's credential. */}
      {!isServiceAccount && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground size-8">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onRevoke}>
              <Unplug />
              Disconnect
            </DropdownMenuItem>
            {mode === "personal" && onDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}

function PendingActions({
  mode,
  onConnect,
  onDelete,
}: {
  mode: McpViewMode;
  onConnect: () => void;
  onDelete?: () => void;
}) {
  return (
    <>
      <Button size="sm" onClick={onConnect} className="h-8">
        <Plug />
        Connect
      </Button>
      {mode === "personal" && onDelete && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground size-8">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
