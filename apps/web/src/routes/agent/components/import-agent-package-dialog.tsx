import type { FileId } from "@mosoo/contracts/id";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileArchive, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";

import { importAgentPackage } from "@/domains/agent/api/agent-client";
import { agentKeys } from "@/domains/agent/query/agent-queries";
import { uploadAgentPackageFile } from "@/domains/file/api/agent-package-file-client";
import { toOrganizationId } from "@/routes/typed-id";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import { isTruthy } from "../../../shared/lib/truthiness";
import { PackageResolutionIssueCard } from "./package-resolution-issue-card";

export function ImportAgentPackageDialog({
  onImportedAgentOpen,
  onOpenChange,
  open,
  organizationId,
}: {
  onImportedAgentOpen: (agentId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId: string | null;
}): ReactElement {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [packageFileId, setPackageFileId] = useState<FileId | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const importMutation = useMutation({
    mutationFn: importAgentPackage,
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({
        queryKey: agentKeys.list(variables.organizationId),
      });
    },
  });
  const importResult = importMutation.data ?? null;
  const importedAgentId = importMutation.data?.agent.id ?? null;
  const issues = importMutation.data?.resolution.issues ?? [];

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) {
      setPackageFileId(null);
      setFileName(null);
      setUploadError(null);
      importMutation.reset();
    }
    onOpenChange(nextOpen);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    importMutation.reset();

    if (organizationId === null) {
      setUploadError("Select an organization before uploading a package.");
      return;
    }

    setUploading(true);
    setUploadError(null);
    setFileName(file.name);
    setPackageFileId(null);

    try {
      const uploaded = await uploadAgentPackageFile(toOrganizationId(organizationId), file);
      setPackageFileId(uploaded.fileId);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Failed to upload package.");
    } finally {
      setUploading(false);
    }
  }

  async function handleImport(): Promise<void> {
    if (organizationId === null || packageFileId === null) {
      return;
    }

    await importMutation.mutateAsync({
      fileId: packageFileId,
      organizationId: toOrganizationId(organizationId),
    });
  }

  function openImportedAgent(): void {
    if (importedAgentId !== null) {
      handleOpenChange(false);
      onImportedAgentOpen(importedAgentId);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Import Agent</DialogTitle>
          <DialogDescription>
            Upload a portable .agent file to create a new draft in this organization.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto px-6 pb-2">
          <input
            accept=".agent"
            aria-label="Upload agent package file"
            className="hidden"
            disabled={uploading || importMutation.isPending || Boolean(importedAgentId)}
            onChange={(event) => void handleFileChange(event)}
            ref={fileInputRef}
            type="file"
          />

          <button
            className="border-border bg-muted/20 hover:bg-muted/40 flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left transition"
            disabled={uploading || importMutation.isPending || Boolean(importedAgentId)}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <FileArchive className="text-muted-foreground size-5 shrink-0" />
            <span className="min-w-0">
              <span className="text-foreground block truncate text-sm font-medium">
                {fileName ?? "Choose .agent file"}
              </span>
              <span className="text-muted-foreground block truncate text-xs">
                {uploading ? "Uploading..." : packageFileId ? "Ready to import" : ".agent"}
              </span>
            </span>
          </button>

          {uploadError !== null || importMutation.error ? (
            <div className="border-destructive/20 bg-destructive/5 text-destructive flex gap-2 rounded-md border px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {uploadError ??
                  (importMutation.error instanceof Error
                    ? importMutation.error.message
                    : "Failed to import package.")}
              </span>
            </div>
          ) : null}

          {importResult !== null ? (
            <div className="border-border bg-muted/20 rounded-md border p-3">
              <div className="text-foreground flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="size-4 text-emerald-600" />
                Draft created
              </div>
              <div className="text-muted-foreground mt-2 grid gap-2 text-xs sm:grid-cols-3">
                <span>Skills {importResult.resolution.summary.boundSkillCount}</span>
                <span>Spaces {importResult.resolution.summary.boundSpaceCount}</span>
                <span>MCP {importResult.resolution.summary.boundMcpServerCount}</span>
              </div>
              {issues.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {issues.map((issue) => (
                    <PackageResolutionIssueCard
                      issue={issue}
                      key={`${issue.code}:${issue.targetLabel ?? ""}`}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-border border-t px-6 py-4">
          {isTruthy(importedAgentId) ? (
            <Button onClick={openImportedAgent}>Open draft</Button>
          ) : (
            <Button
              disabled={
                organizationId === null ||
                packageFileId === null ||
                uploading ||
                importMutation.isPending
              }
              onClick={() => void handleImport()}
            >
              <Upload className="size-3.5" />
              {importMutation.isPending ? "Importing..." : "Import Agent"}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              handleOpenChange(false);
            }}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
