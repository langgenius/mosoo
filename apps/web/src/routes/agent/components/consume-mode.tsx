import { ArrowLeft, Settings } from "lucide-react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/shared/ui/button";

import type { Agent } from "../agent.types";
import { getRuntimeInfo } from "../runtime-catalog";
import { AgentSessionPanel } from "./agent-session-panel";
import { RuntimeIcon } from "./runtime-icon";

export function ConsumeMode({
  agent,
  showConfigButton,
  onOpenConfig,
}: {
  agent: Agent;
  showConfigButton?: boolean;
  onOpenConfig?: () => void;
}): ReactElement {
  const runtime = getRuntimeInfo(agent.runtime);
  const navigate = useNavigate();
  const basePath = globalThis.location.pathname.startsWith("/demo") ? "/demo/agent" : "/agent";
  const shouldShowConfigButton = showConfigButton === true && onOpenConfig !== undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="border-border-subtle flex h-12 shrink-0 items-center gap-3 border-b bg-white px-5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            void navigate(basePath);
          }}
          className="text-muted-foreground"
          aria-label="Back to agents"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <RuntimeIcon runtime={runtime} size={24} />
        <span className="text-foreground text-[14px] font-medium">{agent.name}</span>
        <span className="text-muted-foreground text-[12px]">· {runtime.name}</span>
        {agent.liveVersion ? (
          <span className="border-border bg-muted/40 text-muted-foreground rounded-md border px-1.5 py-0.5 text-[11px]">
            v{agent.liveVersion.versionNumber}
          </span>
        ) : null}
        <div className="flex-1" />
        {shouldShowConfigButton ? (
          <Button
            className="text-muted-foreground hover:text-foreground gap-1.5"
            onClick={onOpenConfig}
            size="xs"
            variant="ghost"
          >
            <Settings className="size-3.5" />
            <span className="text-[12px]">Config</span>
          </Button>
        ) : null}
      </div>

      <div className="flex-1 overflow-hidden">
        <AgentSessionPanel
          key={agent.id}
          agentId={agent.id}
          agentName={agent.name}
          readiness={agent.readiness}
          tone="consume"
          appId={agent.appId}
        />
      </div>
    </div>
  );
}
