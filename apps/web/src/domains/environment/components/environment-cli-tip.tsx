import { Info } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

export const ENVIRONMENT_CLI_CREATE_COMMAND = "mosoo console environments create-environment";

export function EnvironmentCliTip({
  side = "bottom",
  align = "end",
}: Pick<ComponentProps<typeof TooltipContent>, "side" | "align">): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Create Environments faster with the mosoo CLI"
          className="text-fg-3 hover:text-fg-1 focus-visible:ring-brand-ring inline-flex size-5 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} align={align} className="max-w-[300px] text-left">
        <p className="font-semibold">Fastest path: the mosoo CLI</p>
        <p className="mt-1">
          If your project already has dependency files like requirements.txt or package.json and the
          mosoo CLI installed, create this Environment from your terminal instead of filling the
          form by hand:
        </p>
        <code className="bg-background/15 mt-1.5 block rounded px-1.5 py-1 font-mono text-[11px]">
          {ENVIRONMENT_CLI_CREATE_COMMAND}
        </code>
      </TooltipContent>
    </Tooltip>
  );
}
