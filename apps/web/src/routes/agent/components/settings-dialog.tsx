import type { ReactElement } from "react";

import { useTranslation } from "@/shared/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { ProjectIdBadge } from "@/shared/ui/project-id-badge";
import { Separator } from "@/shared/ui/separator";

import type { Agent } from "../agent.types";
import { AgentSettingsDangerZone } from "./settings-dialog-danger-zone";
import { AgentSettingsPackageActions } from "./settings-dialog-package-actions";

export function SettingsSheet({
  agent,
  open,
  onOpenChange,
}: {
  agent: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const published = agent.status === "published";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-x-hidden overflow-y-auto rounded-lg p-0 sm:max-w-[620px]">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle>{t("agent.settings")}</DialogTitle>
          <DialogDescription>
            {t("agent.manageSettingsFor", { name: agent.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 pt-5 pb-4">
          {published ? (
            <ProjectIdBadge
              className="w-fit"
              copiedLabel={t("agent.agentIdCopied")}
              copyLabel={t("agent.copyAgentId")}
              label={t("agent.idPrefix")}
              value={agent.id}
            />
          ) : null}
          <AgentSettingsPackageActions agent={agent} onSettingsOpenChange={onOpenChange} />
        </div>

        {published ? (
          <>
            <Separator />
            <AgentSettingsDangerZone agent={agent} />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
