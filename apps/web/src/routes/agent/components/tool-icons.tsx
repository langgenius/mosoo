import type { ReactElement } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import type { ToolInfo } from "../agent.types";

export function ToolIcons({ tools }: { tools: ToolInfo[] }): ReactElement {
  if (tools.length === 0) {
    return <span className="text-fg-3 text-[12px]">No tools</span>;
  }

  return (
    <div className="flex items-center gap-1">
      {tools.slice(0, 4).map((tool) => (
        <Tooltip key={tool.id}>
          <TooltipTrigger asChild>
            <span className="bg-paper-200 inline-flex size-6 cursor-default items-center justify-center rounded-sm text-[13px]">
              {tool.icon}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span className="text-xs">{tool.name}</span>
          </TooltipContent>
        </Tooltip>
      ))}
      {tools.length > 4 && (
        <span className="text-fg-3 ml-0.5 font-mono text-[11px]">+{tools.length - 4}</span>
      )}
    </div>
  );
}
