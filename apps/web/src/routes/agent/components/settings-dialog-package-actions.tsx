import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Upload } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { createAgentFork, exportAgentPackage } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { createFileDownload } from "@/domains/file/api/file-download-client";
import { toAgentId, toAppId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";

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
  onSettingsOpenChange,
}: {
  agent: Agent;
  canManageAccess: boolean;
  onSettingsOpenChange: (open: boolean) => void;
}): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const typedAgentId = toAgentId(agent.id);
  const typedAppId = toAppId(agent.appId);
  const [showImportPackage, setShowImportPackage] = useState(false);
  const exportPackageMutation = useMutation({
    mutationFn: async () => exportAgentPackage(typedAppId, typedAgentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: agentKeys.manifest(agent.appId, agent.id),
      });
    },
  });
  const forkMutation = useMutation({
    mutationFn: createAgentFork,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.lists() });
    },
  });
  const hasEditorPackageAccess = agent.role === "owner";
  const canUsePackageActions = canManageAccess && hasEditorPackageAccess;
  const packageActionError = exportPackageMutation.error ?? forkMutation.error;

  async function handleExportPackage(): Promise<void> {
    const agentPackage = await exportPackageMutation.mutateAsync();
    const { url } = createFileDownload(agentPackage.fileId);
    globalThis.location.assign(url);
  }

  async function handleForkAgent(): Promise<void> {
    const result = await forkMutation.mutateAsync({
      agentId: typedAgentId,
      appId: typedAppId,
    });
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
          disabled={!canManageAccess}
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
      <ImportAgentPackageDialog
        onImportedAgentOpen={handleImportedAgentOpen}
        onOpenChange={setShowImportPackage}
        open={showImportPackage}
        appId={agent.appId}
      />
    </>
  );
}
