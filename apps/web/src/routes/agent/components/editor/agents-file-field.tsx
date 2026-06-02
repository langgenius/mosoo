import { ExternalLink, FileText, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import type { ChangeEvent, ReactElement } from "react";

import { uploadOrganizationDraftFiles } from "@/domains/file/api/organization-draft-file-client";
import { openFileInline } from "@/domains/file/file-open";
import { toFileId, toOrganizationId } from "@/routes/typed-id";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";

export function AgentsFileField({
  agentsFileId,
  onChange,
  readOnly = false,
  organizationId,
}: {
  agentsFileId: string | null;
  onChange: (nextFileId: string | null) => void;
  readOnly?: boolean;
  organizationId: string | null;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";

    if (file === undefined) {
      return;
    }

    if (organizationId === null || organizationId.length === 0) {
      setUploadError("Select a organization before uploading AGENTS.md.");
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const normalizedFile =
        file.name === "AGENTS.md"
          ? file
          : new File([file], "AGENTS.md", {
              type: file.type || "text/markdown",
            });
      const result = await uploadOrganizationDraftFiles(toOrganizationId(organizationId), [
        normalizedFile,
      ]);
      onChange(result.uploaded[0] ?? null);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Failed to upload AGENTS.md.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {readOnly ? null : (
        <input
          accept=".md,text/markdown"
          aria-label="Upload AGENTS.md file"
          className="hidden"
          onChange={(event) => {
            void handleFileSelected(event);
          }}
          ref={inputRef}
          type="file"
        />
      )}

      {agentsFileId !== null && agentsFileId.length > 0 ? (
        <div className="border-border rounded-lg border p-3">
          <div className="flex items-start gap-3">
            <div className="bg-secondary flex size-9 shrink-0 items-center justify-center rounded-lg">
              <FileText className="text-brand size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-foreground text-[13px] font-medium">AGENTS.md attached</div>
              <div className="text-muted-foreground mt-0.5 text-[11px] break-all">
                File ID: {agentsFileId}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={() => void openFileInline(toFileId(agentsFileId))}
                  size="xs"
                  type="button"
                  variant="outline"
                >
                  <ExternalLink className="size-3" />
                  Open file
                </Button>
                {readOnly ? null : (
                  <Button
                    className="h-7 gap-1.5 px-2 text-[11px]"
                    onClick={() => inputRef.current?.click()}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    <Upload className="size-3" />
                    Replace
                  </Button>
                )}
                {readOnly ? null : (
                  <Button
                    className="h-7 gap-1.5 px-2 text-[11px]"
                    onClick={() => {
                      onChange(null);
                    }}
                    size="xs"
                    type="button"
                    variant="ghost"
                  >
                    <X className="size-3" />
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <button
          className={cn(
            "flex w-full flex-col items-center gap-2 rounded-lg border border-border px-4 py-5 transition-colors",
            readOnly
              ? "cursor-default opacity-60"
              : "cursor-pointer hover:border-border-strong hover:bg-paper-200/40",
          )}
          disabled={readOnly}
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          <Upload className="text-muted-foreground size-5" />
          <div className="text-center">
            <span className="text-muted-foreground text-[13px]">
              Upload <span className="text-foreground font-medium">AGENTS.md</span>
            </span>
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              Stored as a real file asset. Save after upload to bind it to the agent.
            </p>
          </div>
        </button>
      )}

      {uploading ? (
        <div className="text-muted-foreground text-[11px]">Uploading AGENTS.md…</div>
      ) : null}
      {uploadError !== null && uploadError.length > 0 ? (
        <div className="text-destructive text-[11px]">{uploadError}</div>
      ) : null}
    </div>
  );
}
