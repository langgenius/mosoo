import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import { createAgentFork, deleteAgent, getAgentManifest } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentId, toProjectId } from "@/routes/typed-id";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Copy, Download, MoreHorizontal, Trash2 } from "@/shared/ui/icons";

import type { Agent } from "../agent.types";

function sanitizeFileSegment(value: string): string {
  return (
    value
      .trim()
      .replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
      .replaceAll(/^-+|-+$/g, "") || "agent"
  );
}

function downloadTextFile(filename: string, mimeType: string, content: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = globalThis.URL.createObjectURL(blob);
  const link = globalThis.document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();
  globalThis.URL.revokeObjectURL(url);
}

function getActionErrorMessage(error: unknown, defaultMessage: string): string {
  return error instanceof Error ? error.message : defaultMessage;
}

export function AgentRowActions({ agent }: { agent: Agent }): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const typedAgentId = toAgentId(agent.id);
  const typedProjectId = toProjectId(agent.projectId);

  const forkMutation = useMutation({
    mutationFn: createAgentFork,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.list(agent.projectId) });
    },
  });
  const exportMutation = useMutation({
    mutationFn: async () => getAgentManifest(typedProjectId, typedAgentId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: agentKeys.manifest(agent.projectId, agent.id),
      });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAgent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.list(agent.projectId) });
    },
  });

  async function handleDuplicate(): Promise<void> {
    try {
      setActionError(null);
      const result = await forkMutation.mutateAsync({
        agentId: typedAgentId,
        projectId: typedProjectId,
      });

      void navigate(`/agent/${result.agent.id}`);
    } catch (error) {
      setActionError(getActionErrorMessage(error, t("agent.duplicateFailed")));
    }
  }

  async function handleExport(): Promise<void> {
    try {
      setActionError(null);
      const manifest = await exportMutation.mutateAsync();
      downloadTextFile(
        `${sanitizeFileSegment(agent.name)}.manifest.yaml`,
        "text/yaml",
        manifest.yaml,
      );
    } catch (error) {
      setActionError(getActionErrorMessage(error, t("agent.exportConfigFailed")));
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    await deleteMutation.mutateAsync({ agentId: typedAgentId, projectId: typedProjectId });
    setConfirmDelete(false);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("common.moreActions")}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[180px]">
          <DropdownMenuItem
            className="gap-2"
            disabled={forkMutation.isPending}
            onSelect={(event) => {
              event.preventDefault();
              void handleDuplicate();
            }}
          >
            <Copy className="size-3.5" />
            {forkMutation.isPending ? t("agent.duplicating") : t("skills.duplicate")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            disabled={exportMutation.isPending}
            onSelect={(event) => {
              event.preventDefault();
              void handleExport();
            }}
          >
            <Download className="size-3.5" />
            {exportMutation.isPending ? t("agent.exporting") : t("agent.exportConfig")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            className="gap-2"
            onSelect={(event) => {
              event.preventDefault();
              setConfirmDelete(true);
            }}
          >
            <Trash2 className="size-3.5" /> {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={confirmDelete}
        onOpenChange={(next) => {
          if (deleteMutation.isPending) {
            return;
          }
          setConfirmDelete(next);
          if (!next) {
            deleteMutation.reset();
          }
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t("agent.deletePrompt")}</DialogTitle>
            <DialogDescription>
              {t("agent.deleteDescription", { name: agent.name })}
            </DialogDescription>
          </DialogHeader>

          {deleteMutation.error ? (
            <div className="border-danger/30 bg-danger/5 text-danger rounded-md border px-3 py-2 text-xs">
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : t("agent.deleteFailed")}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => {
                setConfirmDelete(false);
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => void handleConfirmDelete()}
            >
              <Trash2 className="size-3.5" />
              {deleteMutation.isPending ? t("agent.deleting") : t("agent.deleteAgent")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={actionError !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setActionError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{t("agent.actionFailed")}</DialogTitle>
            <DialogDescription>
              {actionError ?? t("agent.actionCouldNotBeCompleted")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              size="sm"
              onClick={() => {
                setActionError(null);
              }}
            >
              {t("common.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
