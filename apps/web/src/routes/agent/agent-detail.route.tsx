import { ArrowLeft, Settings, TerminalSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { useAppSession } from "@/app/session-provider";
import { useAgentDetailQuery, useAgentEditorStateQuery } from "@/domains/agent/query/agent-queries";
import { useAuth } from "@/domains/auth/use-auth";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/shared/ui/sheet";

import { isTruthy } from "../../shared/lib/truthiness";
import { canShowAgentDebugMenuItem } from "./agent-debug-menu-policy";
import { mapAgentDetailToView } from "./agent-view.mapper";
import type { Agent, AgentMode } from "./agent.types";
import { ConsumeMode } from "./components/consume-mode";
import { AgentCostTab } from "./components/cost-tab";
import { LogsTab } from "./components/logs-tab";
import { PreviewMode } from "./components/preview-mode";
import { RuntimeIcon } from "./components/runtime-icon";
import { SettingsSheet } from "./components/settings-dialog";
import { VersionsTab } from "./components/versions-tab";
import { getRuntimeInfo } from "./runtime-catalog";

// The terminal pulls in the full xterm engine (~250 kB) and its stylesheet, yet
// it only renders in the debug-only "terminal" mode that most agent visits never
// open. Loading it lazily keeps xterm out of the agent-detail route's initial
// chunk so the default modes paint without paying for the terminal.
const TerminalMode = lazy(async () => {
  const mod = await import("./components/terminal-mode");
  return { default: mod.TerminalMode };
});

type DetailMode = AgentMode | "cost" | "logs" | "terminal";

const MODE_TABS: { id: DetailMode; label: string }[] = [
  { id: "preview", label: "Preview" },
  { id: "logs", label: "Logs" },
  { id: "cost", label: "Cost" },
];

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
        {agent.status === "draft" ? (
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

      <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              onSelectMode(tab.id);
            }}
            className={cn(
              "px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all",
              mode === tab.id ? "bg-ink-100 text-fg-1" : "text-muted-foreground hover:bg-accent",
            )}
          >
            {tab.label}
          </button>
        ))}
        {debugItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectMode(item.id);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-all",
                mode === item.id ? "bg-ink-100 text-fg-1" : "text-muted-foreground hover:bg-accent",
              )}
            >
              <Icon aria-hidden="true" size={14} />
              {item.label}
            </button>
          );
        })}
      </div>

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
  const { activeAppId } = useAppSession();
  const { user } = useAuth();
  const [selectedMode, setSelectedMode] = useState<DetailMode | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [headerActionTarget, setHeaderActionTarget] = useState<HTMLDivElement | null>(null);

  const detailQuery = useAgentDetailQuery(activeAppId, agentId ?? null);
  const canEdit = detailQuery.data ? detailQuery.data.viewerRole === "owner" : false;
  const editorStateQuery = useAgentEditorStateQuery(activeAppId, agentId ?? null, canEdit);

  const agent = useMemo<Agent | null>(() => {
    if (!detailQuery.data) {
      return null;
    }

    return mapAgentDetailToView(detailQuery.data, editorStateQuery.data ?? null, user);
  }, [detailQuery.data, editorStateQuery.data, user]);

  const basePath = globalThis.location.pathname.startsWith("/demo") ? "/demo/agent" : "/agent";
  const runtime = useMemo(() => (agent ? getRuntimeInfo(agent.runtime) : null), [agent]);
  const canManageAgentAccess = detailQuery.data?.viewerRole === "owner";
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

  // Default mode is Preview (config + test chat). Consume is still reachable
  // via `?tab=consume` (e.g. the post-publish success modal's "Open Chat" CTA),
  // and the Preview tab offers an in-context test chat.
  const defaultMode: DetailMode = "preview";
  const requestedMode = selectedMode ?? urlMode ?? defaultMode;
  const mode = requestedMode === "terminal" && !canUseTerminal ? defaultMode : requestedMode;

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

  // Consume mode keeps a config entry point back into the editor.
  if (mode === "consume") {
    return (
      <ConsumeMode
        agent={agent}
        onOpenConfig={() => {
          handleSelectMode("preview");
        }}
        showConfigButton
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <AgentDetailHeader
        agent={agent}
        debugItems={debugItems}
        headerActionTargetRef={setHeaderActionTarget}
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
        {mode === "preview" && (
          <PreviewMode
            agent={agent}
            onSwitchMode={handleSelectMode}
            headerActionTarget={headerActionTarget}
          />
        )}
        {mode === "logs" && <LogsTab agentId={agent.id} appId={agent.appId} />}
        {mode === "cost" && <AgentCostTab agentId={agent.id} appId={agent.appId} />}
        {mode === "terminal" && (
          <Suspense fallback={null}>
            <TerminalMode key={agent.id} agent={agent} />
          </Suspense>
        )}
      </div>

      <SettingsSheet
        agent={agent}
        open={showSettings}
        onOpenChange={setShowSettings}
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
