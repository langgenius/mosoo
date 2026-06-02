import { Upload } from "lucide-react";
import { useEffect } from "react";
import type { ReactElement, ReactNode } from "react";

import { Button } from "@/shared/ui/button";

import type { Agent, AgentMode } from "../agent.types";
import { AgentBuilderPanel } from "./agent-builder/agent-builder-panel";
import { AgentKindSection } from "./agent-kind-section";
import { ConfigPanel } from "./config-panel";
import { useAgentEditorModel } from "./editor/use-model";

export function DevMode({
  agent,
  onSwitchMode,
  onHeaderCtaChange,
}: {
  agent: Agent;
  onSwitchMode: (mode: AgentMode | "logs") => void;
  onHeaderCtaChange?: (cta: ReactNode) => void;
}): ReactElement {
  const model = useAgentEditorModel({ agent });
  const previewBlocked =
    agent.readiness?.issues.some((issue) => issue.severity === "error") ?? false;
  const previewDisabled = previewBlocked || model.dirty || model.saving;

  useEffect(() => {
    if (onHeaderCtaChange !== undefined) {
      onHeaderCtaChange(
        <Button
          disabled={previewDisabled}
          onClick={() => {
            onSwitchMode("preview");
          }}
          size="sm"
        >
          <Upload />
          Preview changes
        </Button>,
      );
    }

    return () => {
      onHeaderCtaChange?.(null);
    };
  }, [onHeaderCtaChange, previewDisabled, onSwitchMode]);

  return (
    <div className="flex h-full min-h-0 bg-[#fafafa]">
      <div className="border-border-subtle min-h-0 w-[40%] min-w-[360px] shrink-0 border-r">
        <AgentBuilderPanel
          agent={agent}
          draftRevision={model.draftYamlHash}
          draftYaml={model.draftYaml}
          onDraftPatchAutoApply={model.applyAndSaveBuilderPatch}
          onDraftPatchFocus={model.focusBuilderPatchSection}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[820px] space-y-4 p-5">
          <AgentKindSection
            agent={{ ...agent, kind: model.draft.kind }}
            onKindChange={model.setKind}
          />
          <div className="border-border-subtle overflow-hidden rounded-xl border bg-white">
            <ConfigPanel agent={agent} model={model} />
          </div>
        </div>
      </div>
    </div>
  );
}
