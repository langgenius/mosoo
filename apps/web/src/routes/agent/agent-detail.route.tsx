import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { useAppSession } from "@/app/session/session-context";
import { useAgentDetailQuery, useAgentEditorStateQuery } from "@/domains/agent/query/agent-queries";
import { useTranslation } from "@/shared/i18n";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ArrowLeft, Settings } from "@/shared/ui/icons";

import { mapAgentDetailToView } from "./agent-view.mapper";
import type { Agent } from "./agent.types";
import { PreviewMode } from "./components/preview-mode";
import { RuntimeIcon } from "./components/runtime-icon";
import { getRuntimeInfo } from "./runtime-catalog";

const LogsTab = lazy(async () => {
  const mod = await import("./components/logs-tab");
  return { default: mod.LogsTab };
});

const AgentCostTab = lazy(async () => {
  const mod = await import("./components/cost-tab");
  return { default: mod.AgentCostTab };
});

const SettingsSheet = lazy(async () => {
  const mod = await import("./components/settings-dialog");
  return { default: mod.SettingsSheet };
});

type DetailMode = "cost" | "logs" | "preview";

interface VersionsSheetProps {
  agent: Agent;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const VersionsSheet = lazy(async () => {
  const [sheetModule, versionsModule] = await Promise.all([
    import("@/shared/ui/sheet"),
    import("./components/versions-tab"),
  ]);
  const { Sheet, SheetContent, SheetTitle } = sheetModule;
  const { VersionsTab } = versionsModule;

  function VersionsSheetContent({ agent, onOpenChange, open }: VersionsSheetProps) {
    const { t } = useTranslation();
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[560px] max-w-[calc(100vw-2rem)] p-0">
          <SheetTitle className="sr-only">{t("agent.versions")}</SheetTitle>
          <VersionsTab agent={agent} />
        </SheetContent>
      </Sheet>
    );
  }

  return { default: VersionsSheetContent };
});

const MODE_TABS: { id: DetailMode; labelKey: string }[] = [
  { id: "preview", labelKey: "agent.preview" },
  { id: "logs", labelKey: "agent.logs" },
  { id: "cost", labelKey: "agent.cost" },
];

function toDetailMode(value: string | null): DetailMode | null {
  switch (value) {
    case "cost":
    case "logs":
    case "preview":
      return value;
    default:
      return null;
  }
}

function AgentDetailHeader({
  agent,
  headerActionTargetRef,
  mode,
  onBack,
  onOpenSettings,
  onOpenVersions,
  onSelectMode,
  runtime,
}: {
  agent: Agent;
  headerActionTargetRef: (node: HTMLDivElement | null) => void;
  mode: DetailMode;
  onBack: () => void;
  onOpenSettings: () => void;
  onOpenVersions: () => void;
  onSelectMode: (mode: DetailMode) => void;
  runtime: ReturnType<typeof getRuntimeInfo> | null;
}) {
  const { t } = useTranslation();

  return (
    <header className="border-border-soft bg-card flex min-h-13 shrink-0 flex-wrap items-center gap-y-2 border-b px-3 py-2 sm:px-5 lg:h-13 lg:flex-nowrap lg:py-0">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 lg:flex-initial">
        <Button
          aria-label={t("agent.backToAgents")}
          variant="ghost"
          size="icon-sm"
          onClick={onBack}
          className="text-fg-3 shrink-0"
        >
          <ArrowLeft className="size-4" />
        </Button>

        {runtime ? (
          <span className="hidden shrink-0 sm:block">
            <RuntimeIcon runtime={runtime} size={28} />
          </span>
        ) : null}
        <span
          className="text-foreground min-w-0 truncate text-[14px] font-medium"
          title={agent.name}
        >
          {agent.name}
        </span>
        {agent.status === "draft" ? (
          <Badge
            asChild
            variant="warning"
            className="hover:bg-warning-bg/70 ml-1 cursor-pointer focus:outline-none"
          >
            <button
              type="button"
              onClick={onOpenVersions}
              aria-label={t("agent.openVersionHistory")}
            >
              {t("agent.draft")}
            </button>
          </Badge>
        ) : agent.liveVersion ? (
          <Badge
            asChild
            variant="brand"
            className="hover:bg-brand-soft-hover ml-1 cursor-pointer focus:outline-none"
          >
            <button
              type="button"
              onClick={onOpenVersions}
              aria-label={t("agent.openVersionHistory")}
            >
              v{agent.liveVersion.versionNumber} {t("agent.live")}
            </button>
          </Badge>
        ) : null}
      </div>

      {/* From lg the tab strip stays in flow with auto margins: centred while there
          is room, and a long name truncates inside the identity cluster instead of
          running underneath the tabs. Below lg the strip wraps to its own row. */}
      <div className="border-border-soft order-3 flex w-full items-center gap-1 overflow-x-auto border-t pt-2 lg:order-none lg:mx-auto lg:w-auto lg:shrink-0 lg:border-0 lg:px-3 lg:pt-0">
        {MODE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              onSelectMode(tab.id);
            }}
            className={cn(
              "rounded-sm px-3.5 py-1.5 text-[13px] font-medium transition-[background-color,color] duration-150 ease-out",
              mode === tab.id
                ? "bg-selected text-fg-1"
                : "text-fg-2 hover:bg-hover hover:text-fg-1",
            )}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <div ref={headerActionTargetRef} className="flex items-center gap-2" />
        <Button
          aria-label={t("agent.settings")}
          variant="ghost"
          size="icon-sm"
          onClick={onOpenSettings}
          className="text-fg-3"
        >
          <Settings className="size-4" />
        </Button>
      </div>
    </header>
  );
}

function PanelLoading(): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="text-fg-3 flex h-full items-center justify-center text-sm">
      {t("common.loading")}
    </div>
  );
}

export function AgentDetailPage() {
  const { t } = useTranslation();
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeProjectId } = useAppSession();
  const [selectedMode, setSelectedMode] = useState<DetailMode | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [headerActionTarget, setHeaderActionTarget] = useState<HTMLDivElement | null>(null);

  const detailQuery = useAgentDetailQuery(activeProjectId, agentId ?? null);
  const detailLoaded = detailQuery.data !== undefined;
  const editorStateQuery = useAgentEditorStateQuery(activeProjectId, agentId ?? null, detailLoaded);

  const agent = useMemo<Agent | null>(() => {
    if (!detailQuery.data) {
      return null;
    }

    return mapAgentDetailToView(detailQuery.data, editorStateQuery.data ?? null);
  }, [detailQuery.data, editorStateQuery.data]);

  const runtime = useMemo(() => (agent ? getRuntimeInfo(agent.runtime) : null), [agent]);
  const urlMode = toDetailMode(searchParams.get("tab"));

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

  // Default mode is Preview (config + test chat).
  const mode = selectedMode ?? urlMode ?? "preview";

  if (
    detailQuery.isLoading ||
    (detailLoaded && editorStateQuery.isLoading && !editorStateQuery.data)
  ) {
    return (
      <div className="text-fg-3 flex h-full items-center justify-center text-sm">
        {t("agent.loadingAgent")}
      </div>
    );
  }

  const loadError = detailQuery.error ?? editorStateQuery.error;

  if (loadError || !agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="text-danger text-sm">
          {loadError instanceof Error ? loadError.message : t("agent.notFound")}
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void navigate("/agent");
          }}
        >
          {t("agent.backToAgents")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <AgentDetailHeader
        agent={agent}
        headerActionTargetRef={setHeaderActionTarget}
        mode={mode}
        onBack={() => {
          void navigate("/agent");
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
          <PreviewMode agent={agent} headerActionTarget={headerActionTarget} />
        )}
        {mode === "logs" && (
          <Suspense fallback={<PanelLoading />}>
            <LogsTab agentId={agent.id} projectId={agent.projectId} />
          </Suspense>
        )}
        {mode === "cost" && (
          <Suspense fallback={<PanelLoading />}>
            <AgentCostTab agentId={agent.id} projectId={agent.projectId} />
          </Suspense>
        )}
      </div>

      {showSettings ? (
        <Suspense fallback={null}>
          <SettingsSheet agent={agent} open={showSettings} onOpenChange={setShowSettings} />
        </Suspense>
      ) : null}

      {showVersions ? (
        <Suspense fallback={null}>
          <VersionsSheet agent={agent} open={showVersions} onOpenChange={setShowVersions} />
        </Suspense>
      ) : null}
    </div>
  );
}
