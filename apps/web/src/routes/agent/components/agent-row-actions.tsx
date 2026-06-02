import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, MoreHorizontal, Pencil, Settings, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";

import { createAgentFork, deleteAgent, getAgentManifest } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { toAgentId, toOrganizationId } from "@/routes/typed-id";
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

import type { Agent } from "../agent.types";

function getBasePath(): string {
  return globalThis.location.pathname.startsWith("/demo") ? "/demo/agent" : "/agent";
}

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

export function AgentRowActions({
  agent,
  organizationId,
}: {
  agent: Agent;
  organizationId: string | null;
}): ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isEditor = agent.role === "owner" || agent.role === "admin";
  const canDelete = agent.role === "owner";
  const typedAgentId = toAgentId(agent.id);
  const typedOrganizationId = organizationId === null ? null : toOrganizationId(organizationId);

  const forkMutation = useMutation({
    mutationFn: createAgentFork,
    onSuccess: async () => {
      const queryKey =
        typedOrganizationId === null ? agentKeys.lists() : agentKeys.list(typedOrganizationId);

      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const exportMutation = useMutation({
    mutationFn: getAgentManifest,
    onSuccess: async (_data, agentId) => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.manifest(agentId) });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteAgent,
    onSuccess: async () => {
      const queryKey =
        typedOrganizationId === null ? agentKeys.lists() : agentKeys.list(typedOrganizationId);

      await queryClient.invalidateQueries({ queryKey });
    },
  });

  function handleConfig(): void {
    void navigate(`${getBasePath()}/${agent.id}?settings=1`);
  }

  function handleEdit(): void {
    void navigate(`${getBasePath()}/${agent.id}?tab=dev`);
  }

  async function handleDuplicate(): Promise<void> {
    try {
      setActionError(null);
      const result = await forkMutation.mutateAsync({ agentId: typedAgentId });

      void navigate(`${getBasePath()}/${result.agent.id}`);
    } catch (error) {
      setActionError(getActionErrorMessage(error, "Failed to duplicate agent."));
    }
  }

  async function handleExport(): Promise<void> {
    try {
      setActionError(null);
      const manifest = await exportMutation.mutateAsync(typedAgentId);
      downloadTextFile(
        `${sanitizeFileSegment(agent.name)}.manifest.yaml`,
        "text/yaml",
        manifest.yaml,
      );
    } catch (error) {
      setActionError(getActionErrorMessage(error, "Failed to export agent manifest."));
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    await deleteMutation.mutateAsync({ agentId: typedAgentId });
    setConfirmDelete(false);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="More actions"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[180px]">
          {isEditor && (
            <DropdownMenuItem className="gap-2" onSelect={handleConfig}>
              <Settings className="size-3.5" /> Config
            </DropdownMenuItem>
          )}
          {isEditor && (
            <DropdownMenuItem className="gap-2" onSelect={handleEdit}>
              <Pencil className="size-3.5" /> Edit
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="gap-2"
            disabled={forkMutation.isPending}
            onSelect={(event) => {
              event.preventDefault();
              void handleDuplicate();
            }}
          >
            <Copy className="size-3.5" />
            {forkMutation.isPending ? "Duplicating…" : "Duplicate"}
          </DropdownMenuItem>
          {isEditor && (
            <DropdownMenuItem
              className="gap-2"
              disabled={exportMutation.isPending}
              onSelect={(event) => {
                event.preventDefault();
                void handleExport();
              }}
            >
              <Download className="size-3.5" />
              {exportMutation.isPending ? "Exporting…" : "Export config"}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="gap-2"
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirmDelete(true);
                }}
              >
                <Trash2 className="size-3.5" /> Delete
              </DropdownMenuItem>
            </>
          )}
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
            <DialogTitle>Delete this agent?</DialogTitle>
            <DialogDescription>
              <strong>{agent.name}</strong> and all its records will be permanently removed. This
              cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteMutation.error ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
              {deleteMutation.error instanceof Error
                ? deleteMutation.error.message
                : "Failed to delete agent."}
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
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => void handleConfirmDelete()}
            >
              <Trash2 className="size-3.5" />
              {deleteMutation.isPending ? "Deleting…" : "Delete agent"}
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
            <DialogTitle>Action failed</DialogTitle>
            <DialogDescription>
              {actionError ?? "The action could not be completed."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              size="sm"
              onClick={() => {
                setActionError(null);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
