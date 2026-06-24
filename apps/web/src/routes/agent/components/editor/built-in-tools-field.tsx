import type { AgentBuiltInToolConfig, AgentBuiltInToolName } from "@mosoo/contracts/agent";
import { AGENT_BUILT_IN_TOOL_NAMES, normalizeAgentBuiltInTools } from "@mosoo/contracts/agent";
import type { ReactElement } from "react";

import { Switch } from "@/shared/ui/switch";

const TOOL_LABELS = {
  bash: "Bash",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  read: "Read",
  web_fetch: "Web fetch",
  web_search: "Web search",
  write: "Write",
} as const satisfies Record<AgentBuiltInToolName, string>;

function setToolEnabled(
  tools: readonly AgentBuiltInToolConfig[],
  name: AgentBuiltInToolName,
  enabled: boolean,
): AgentBuiltInToolConfig[] {
  return normalizeAgentBuiltInTools(
    tools.map((tool) => (tool.name === name ? { ...tool, enabled } : tool)),
  );
}

export function BuiltInToolsField({
  readOnly,
  tools,
  setTools,
}: {
  readOnly: boolean;
  tools: AgentBuiltInToolConfig[];
  setTools(tools: AgentBuiltInToolConfig[]): void;
}): ReactElement {
  const normalizedTools = normalizeAgentBuiltInTools(tools);
  const toolsByName = new Map(normalizedTools.map((tool) => [tool.name, tool.enabled]));

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {AGENT_BUILT_IN_TOOL_NAMES.map((toolName) => {
        const id = `agent-built-in-tool-${toolName}`;
        const enabled = toolsByName.get(toolName) ?? true;

        return (
          <label
            className="border-border-subtle flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2"
            htmlFor={id}
            key={toolName}
          >
            <span className="text-foreground text-[13px] font-medium">{TOOL_LABELS[toolName]}</span>
            <Switch
              checked={enabled}
              disabled={readOnly}
              id={id}
              onCheckedChange={(checked) => {
                setTools(setToolEnabled(normalizedTools, toolName, checked));
              }}
            />
          </label>
        );
      })}
    </div>
  );
}
