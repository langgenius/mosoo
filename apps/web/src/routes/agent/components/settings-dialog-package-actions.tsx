import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Upload } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  createAgentFork,
  exportAgentPackage,
  updateAgentPackageSharing,
} from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { createFileDownload } from "@/domains/file/api/file-download-client";
import { toAgentId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";

import type { Agent } from "../agent.types";
import { ImportAgentPackageDialog } from "./import-agent-package-dialog";

function currentAgentBasePath(): string {
  return globalThis.location.pathname.startsWith("/demo") ? "/demo/agent" : "/agent";
}

function packageErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Agent package action failed.";
}

export function AgentSettingsPackageActions({
  agent,
  canManageAccess,
  organizationId,
  onSettingsOpenChange,
}: {
  agent: Agent;
  canManageAccess: boolean;
  organizationId: string | null;
  onSettingsOpenChange: (open: boolean) => void;
}): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const typedAgentId = toAgentId(agent.id);
  const [showImportPackage, setShowImportPackage] = useState(false);
  const exportPackageMutation = useMutation({
    mutationFn: exportAgentPackage,
    onSuccess: async (_data, agentId) => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.manifest(agentId) });
    },
  });
  const forkMutation = useMutation({
    mutationFn: createAgentFork,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });
  const updatePackageSharingMutation = useMutation({
    mutationFn: updateAgentPackageSharing,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentKeys.detail(agent.id) });
      void queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });

  const isPublished = agent.status === "published";
  const hasEditorPackageAccess = agent.role === "owner" || agent.role === "admin";
  const canUsePackageActions =
    hasEditorPackageAccess || (isPublished && agent.packageSharingEnabled);
  const packageActionError =
    exportPackageMutation.error ?? forkMutation.error ?? updatePackageSharingMutation.error;

  async function handleExportPackage(): Promise<void> {
    const agentPackage = await exportPackageMutation.mutateAsync(typedAgentId);
    const { url } = createFileDownload(agentPackage.fileId);
    globalThis.location.assign(url);
  }

  async function handleForkAgent(): Promise<void> {
    const result = await forkMutation.mutateAsync({ agentId: typedAgentId });
    onSettingsOpenChange(false);
    void navigate(`${currentAgentBasePath()}/${result.agent.id}`);
  }

  function handleImportedAgentOpen(agentId: string): void {
    void navigate(`${currentAgentBasePath()}/${agentId}`);
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          className="gap-1.5 rounded-lg text-[12px]"
          disabled={exportPackageMutation.isPending || !canUsePackageActions}
          onClick={() => void handleExportPackage()}
          size="xs"
          variant="outline"
        >
          <Download className="size-3.5" />
          {exportPackageMutation.isPending ? "Exporting..." : "Export agent"}
        </Button>
        <Button
          className="gap-1.5 rounded-lg text-[12px]"
          onClick={() => {
            setShowImportPackage(true);
          }}
          size="xs"
          variant="outline"
        >
          <Upload className="size-3.5" />
          Import agent
        </Button>
        <Button
          className="gap-1.5 rounded-lg text-[12px]"
          disabled={forkMutation.isPending || !canUsePackageActions}
          onClick={() => void handleForkAgent()}
          size="xs"
          variant="outline"
        >
          <Copy className="size-3.5" />
          {forkMutation.isPending ? "Forking..." : "Fork agent"}
        </Button>
      </div>
      {packageActionError !== null ? (
        <div className="text-destructive text-xs">{packageErrorMessage(packageActionError)}</div>
      ) : null}
      {canManageAccess ? (
        <label
          className="border-border-subtle bg-card flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5"
          htmlFor={`agent-package-sharing-${agent.id}`}
        >
          <div>
            <div className="text-foreground text-sm font-medium">
              Allow users to fork and export
            </div>
            <div className="text-muted-foreground mt-0.5 text-xs">
              Published Agent users can fork and download a portable .agent file.
            </div>
          </div>
          <Switch
            checked={agent.packageSharingEnabled}
            disabled={updatePackageSharingMutation.isPending}
            id={`agent-package-sharing-${agent.id}`}
            onCheckedChange={(checked) =>
              void updatePackageSharingMutation.mutateAsync({
                agentId: typedAgentId,
                packageSharingEnabled: checked,
              })
            }
          />
        </label>
      ) : null}
      <ImportAgentPackageDialog
        onImportedAgentOpen={handleImportedAgentOpen}
        onOpenChange={setShowImportPackage}
        open={showImportPackage}
        organizationId={organizationId}
      />
    </>
  );
}
