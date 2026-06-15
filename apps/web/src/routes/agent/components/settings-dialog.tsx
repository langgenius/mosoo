import type { ReactElement } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Separator } from "@/shared/ui/separator";

import type { Agent } from "../agent.types";
import { AgentSettingsSummary } from "./settings-dialog-agent-summary";
import { AgentSettingsDangerZone } from "./settings-dialog-danger-zone";
import { AgentSettingsPackageActions } from "./settings-dialog-package-actions";

export function SettingsSheet({
  agent,
  canManageAccess = true,
  open,
  onOpenChange,
}: {
  agent: Agent;
  canManageAccess?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-x-hidden overflow-y-auto rounded-lg p-0 sm:max-w-[620px]">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle>Agent settings</DialogTitle>
          <DialogDescription>
            {canManageAccess
              ? `Manage settings for "${agent.name}".`
              : `View settings for "${agent.name}".`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 pt-5 pb-4">
          <AgentSettingsSummary agent={agent} />
          <AgentSettingsPackageActions
            agent={agent}
            canManageAccess={canManageAccess}
            onSettingsOpenChange={onOpenChange}
          />
        </div>

        {canManageAccess ? (
          <>
            <Separator />
            <AgentSettingsDangerZone agent={agent} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
