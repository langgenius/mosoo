import { ArrowLeft, ChevronDown, Settings, TerminalSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { useAgentDetailQuery, useAgentEditorStateQuery } from "@/domains/agent/query/agent-queries";
import { useAuth } from "@/domains/auth/use-auth";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/shared/ui/sheet";

import { isTruthy } from "../../shared/lib/truthiness";
import { canShowAgentDebugMenuItem } from "./agent-debug-menu-policy";
import { mapAgentDetailToView } from "./agent-view.mapper";
import type { Agent, AgentMode } from "./agent.types";
import { ConsumeMode } from "./components/consume-mode";
import { AgentCostTab } from "./components/cost-tab";
import { DevMode } from "./components/dev-mode";
import { LogsTab } from "./components/logs-tab";
import { PreviewMode } from "./components/preview-mode";
import { RuntimeIcon } from "./components/runtime-icon";
import { SettingsSheet } from "./components/settings-dialog";
import { TerminalMode } from "./components/terminal-mode";
import { VersionsTab } from "./components/versions-tab";
import { LifecycleShell } from "./lifecycle/lifecycle-shell";
import { getRuntimeInfo } from "./runtime-catalog";

type DetailMode = AgentMode | "cost" | "logs" | "terminal";

const MODE_TABS: { id: DetailMode; label: string; ownerOnly?: boolean }[] = [
  { id: "dev", label: "Dev", ownerOnly: true },
  { id: "preview", label: "Preview" },
  { id: "logs", label: "Logs", ownerOnly: true },
  { id: "cost", label: "Cost", ownerOnly: true },
];

const DEBUG_MODES = new Set<DetailMode>(["terminal"]);

interface DebugModeItem {
  icon: LucideIcon;
  id: Extract<DetailMode, "terminal">;
  label: string;
}

function toDetailMode(value: string | null): DetailMode | null {
  switch (value) {
    case "consume":
    case "cost":
    case "create":
    case "dev":
    case "logs":
    case "preview":
    case "terminal":
      return value;
    default:
      return null;
  }
}

function AgentDetailHeader({
  agent,
  debugItems,
  headerActionTargetRef,
  headerCenterTargetRef,
  isDraftLifecycle,
  isOwnerOrAdmin,
  lifecycleMode,
  mode,
  onBack,
  onOpenSettings,
  onOpenVersions,
  onSelectMode,
  runtime,
}: {
  agent: Agent;
  debugItems: DebugModeItem[];
  headerActionTargetRef: (node: HTMLDivElement | null) => void;
  headerCenterTargetRef: (node: HTMLDivElement | null) => void;
  isDraftLifecycle: boolean;
  isOwnerOrAdmin: boolean;
  lifecycleMode: Extract<DetailMode, "dev" | "preview"> | null;
  mode: DetailMode;
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenVersions: () => void;
  onSelectMode: (mode: DetailMode) => void;
  runtime: ReturnType<typeof getRuntimeInfo> | null;
}) {
  return (
    <header className="border-border-subtle relative flex h-13 shrink-0 items-center justify-between border-b bg-white px-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={onBack} className="text-muted-foreground">
          <ArrowLeft className="size-4" />
        </Button>

        {runtime ? <RuntimeIcon runtime={runtime} size={28} /> : null}
        <span className="text-foreground text-[14px] font-medium">{agent.name}</span>
        {isDraftLifecycle ? (
          <button
            type="button"
            onClick={onOpenVersions}
            className="focus-visible:ring-ring bg-amber-bg text-amber-fg hover:bg-amber-bg/70 ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2"
            aria-label="Open version history"
          >
            Draft
          </button>
        ) : agent.liveVersion ? (
          <button
            type="button"
            onClick={onOpenVersions}
            className="focus-visible:ring-ring ml-1 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800 transition-colors hover:bg-green-200/70 focus:outline-none focus-visible:ring-2"
            aria-label="Open version history"
          >
            v{agent.liveVersion.versionNumber} live
          </button>
        ) : null}
      </div>

      {isDraftLifecycle && lifecycleMode ? (
        <div
          className="absolute left-1/2 flex -translate-x-1/2 items-center"
          ref={headerCenterTargetRef}
        />
      ) : (
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
          {MODE_TABS.flatMap((tab) =>
            tab.ownerOnly === true && !isOwnerOrAdmin
              ? []
              : [
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      onSelectMode(tab.id);
                    }}
                    className={cn(
                      "px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all",
                      mode === tab.id
                        ? "bg-ink-100 text-fg-1"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {tab.label}
                  </button>,
                ],
          )}
          {debugItems.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1 rounded-lg px-3.5 py-1.5 text-[13px] font-medium outline-none transition-all",
                    DEBUG_MODES.has(mode)
                      ? "bg-ink-100 text-fg-1"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  Debug
                  <ChevronDown aria-hidden="true" size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {debugItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <DropdownMenuItem
                      key={item.id}
                      onSelect={() => {
                        onSelectMode(item.id);
                      }}
                    >
                      <Icon aria-hidden="true" size={14} />
                      <span className="flex-1">{item.label}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div ref={headerActionTargetRef} className="flex items-center gap-2" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenSettings}
          className="text-muted-foreground"
        >
          <Settings className="size-4" />
        </Button>
      </div>
    </header>
  );
}

export function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeOrganization } = useAppSession();
  const { user } = useAuth();
  const [selectedMode, setSelectedMode] = useState<DetailMode | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [headerActionTarget, setHeaderActionTarget] = useState<HTMLDivElement | null>(null);
  const [headerCenterTarget, setHeaderCenterTarget] = useState<HTMLDivElement | null>(null);

  const detailQuery = useAgentDetailQuery(agentId ?? null);
  const canEdit = detailQuery.data
    ? detailQuery.data.viewerRole === "owner" || detailQuery.data.viewerRole === "admin"
    : false;
  const editorStateQuery = useAgentEditorStateQuery(agentId ?? null, canEdit);

  const agent = useMemo<Agent | null>(() => {
    if (!detailQuery.data) {
      return null;
    }

    return mapAgentDetailToView(detailQuery.data, editorStateQuery.data ?? null, user);
  }, [detailQuery.data, editorStateQuery.data, user]);

  const basePath = globalThis.location.pathname.startsWith("/demo") ? "/demo/agent" : "/agent";
  const runtime = useMemo(() => (agent ? getRuntimeInfo(agent.runtime) : null), [agent]);
  const isOwnerOrAdmin = agent?.role === "owner" || agent?.role === "admin";
  const viewerOrgRole =
    activeOrganization && activeOrganization.id === detailQuery.data?.organizationId
      ? activeOrganization.viewerRole
      : null;
  const canManageAgentAccess =
    detailQuery.data?.viewerRole === "owner" || viewerOrgRole === "owner";
  const canUseTerminal = canShowAgentDebugMenuItem({
    agentKind: agent?.kind ?? null,
    itemId: "terminal",
    viewerRole: detailQuery.data?.viewerRole ?? null,
  });
  const debugItems: DebugModeItem[] = [];
  if (canUseTerminal) {
    debugItems.push({ icon: TerminalSquare, id: "terminal", label: "Terminal" });
  }
  const urlMode = toDetailMode(searchParams.get("tab") ?? searchParams.get("mode"));

  const handleSelectMode = useCallback(
    (nextMode: DetailMode) => {
      setSelectedMode(nextMode);
      setSearchParams(
        (current) => {
          const nextParams = new URLSearchParams(current);
          nextParams.set("tab", nextMode);
          return nextParams;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Allow other surfaces (e.g. the Agents list dropdown) to deep-link
  // Straight into the settings sheet via `?settings=1`.
  const settingsParam = searchParams.get("settings");
  useEffect(() => {
    if (settingsParam !== "1") {
      return;
    }
    setShowSettings(true);
    setSearchParams(
      (current) => {
        const nextParams = new URLSearchParams(current);
        nextParams.delete("settings");
        return nextParams;
      },
      { replace: true },
    );
  }, [settingsParam, setSearchParams]);

  // Default mode: Owner/Admin → Dev (config), others → Consume (read-only chat).
  // Owners can still reach Consume via `?tab=consume` (e.g. the
  // post-publish success modal's "Open Chat" CTA) or the Preview tab for
  // an in-context test chat.
  const defaultMode: DetailMode = isOwnerOrAdmin ? "dev" : "consume";
  const requestedMode = selectedMode ?? urlMode ?? defaultMode;
  const mode =
    !isOwnerOrAdmin && requestedMode !== "consume"
      ? "consume"
      : requestedMode === "terminal" && !canUseTerminal
        ? defaultMode
        : requestedMode;

  if (!isTruthy(agentId)) {
    return (
      <div className="text-destructive flex h-full items-center justify-center text-sm">
        Agent id is missing.
      </div>
    );
  }

  if (detailQuery.isLoading || (canEdit && editorStateQuery.isLoading && !editorStateQuery.data)) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        Loading agent…
      </div>
    );
  }

  const loadError = detailQuery.error ?? editorStateQuery.error;

  if (loadError || !agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="text-destructive text-sm">
          {loadError instanceof Error ? loadError.message : "Agent not found."}
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void navigate(basePath);
          }}
        >
          Back to agents
        </Button>
      </div>
    );
  }

  const detail = detailQuery.data;

  if (!detail) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="text-destructive text-sm">Agent not found.</div>
        <Button
          variant="outline"
          onClick={() => {
            void navigate(basePath);
          }}
        >
          Back to agents
        </Button>
      </div>
    );
  }

  // ── User role on published agent → pure Consume mode ──
  if (!isOwnerOrAdmin) {
    return <ConsumeMode agent={agent} organizationId={detail.organizationId} />;
  }

  // ── Owner/Admin on published agent in consume mode → Chat + Config button ──
  if (mode === "consume") {
    return (
      <ConsumeMode
        agent={agent}
        onOpenConfig={() => {
          handleSelectMode("dev");
        }}
        showConfigButton
        organizationId={detail.organizationId}
      />
    );
  }

  // ── Owner/Admin config modes (Create / Preview / Dev / Logs) ──
  // Lifecycle shell wraps Draft agents in the Configure / Preview / Publish
  // surfaces. Live agents fall through to the existing tabbed UI unchanged.
  const isDraftLifecycle = agent.status === "draft";
  const lifecycleMode = mode === "dev" || mode === "preview" ? mode : null;

  return (
    <div className="flex h-full flex-col">
      <AgentDetailHeader
        agent={agent}
        debugItems={debugItems}
        headerActionTargetRef={setHeaderActionTarget}
        headerCenterTargetRef={setHeaderCenterTarget}
        isDraftLifecycle={isDraftLifecycle}
        isOwnerOrAdmin={isOwnerOrAdmin}
        lifecycleMode={lifecycleMode}
        mode={mode}
        onBack={() => {
          void navigate(basePath);
        }}
        onOpenSettings={() => {
          setShowSettings(true);
        }}
        onOpenVersions={() => {
          setShowVersions(true);
        }}
        onSelectMode={handleSelectMode}
        runtime={runtime}
      />

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {isDraftLifecycle && lifecycleMode ? (
          <LifecycleShell
            agent={agent}
            headerCenterTarget={headerCenterTarget}
            mode={lifecycleMode}
            onSwitchMode={handleSelectMode}
            organizationId={detail.organizationId}
            headerActionTarget={headerActionTarget}
          />
        ) : (
          <>
            {mode === "preview" && (
              <PreviewMode
                agent={agent}
                onSwitchMode={handleSelectMode}
                organizationId={detail.organizationId}
                headerActionTarget={headerActionTarget}
              />
            )}
            {mode === "dev" && (
              <DevMode
                agent={agent}
                onSwitchMode={handleSelectMode}
                headerActionTarget={headerActionTarget}
              />
            )}
          </>
        )}
        {mode === "logs" && <LogsTab agentId={agent.id} />}
        {mode === "cost" && <AgentCostTab agentId={agent.id} />}
        {mode === "terminal" && <TerminalMode key={agent.id} agent={agent} />}
      </div>

      <SettingsSheet
        agent={agent}
        open={showSettings}
        onOpenChange={setShowSettings}
        organizationId={detail.organizationId}
        canManageAccess={canManageAgentAccess}
      />

      <Sheet open={showVersions} onOpenChange={setShowVersions}>
        <SheetContent className="w-[560px] max-w-[calc(100vw-2rem)] p-0">
          <SheetTitle className="sr-only">Versions</SheetTitle>
          <VersionsTab agent={agent} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
