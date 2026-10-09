import type { ReactElement } from "react";

import type { Agent } from "../../agent.types";
import { BasicsSection, EnvironmentSection, IntegrationsSection } from "./form-sections";
import type { AgentEditorModel } from "./use-model";

// Three-section form layout (locked on 2026-05-05):
//   1. Basics       — name, description, runtime, model, system prompt
//   2. Integrations — skills, MCP servers
//   3. Environment  — environment
// Runtime-native JSON settings live under Basics next to model selection; keep
// future runtime-specific typed fields section-scoped when they arrive.
// A single continuous scroll with dividers between sections.
export function AgentFormView({
  agent,
  model,
}: {
  agent: Agent;
  model: AgentEditorModel;
}): ReactElement {
  return (
    <div className="space-y-0">
      <div className="pb-5">
        <BasicsSection agent={agent} model={model} />
      </div>

      <div className="border-border-soft border-t py-5">
        <IntegrationsSection model={model} projectId={agent.projectId} />
      </div>

      <div className="border-border-soft border-t py-5">
        <EnvironmentSection agent={agent} model={model} />
      </div>
    </div>
  );
}
