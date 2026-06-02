import type { SkillInspectResult } from "@mosoo/contracts/skill";
import { useRef, useState } from "react";

import { cn } from "@/shared/lib/class-names";
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
import type { useSkillRegistry } from "./use-skill-registry";
interface Props {
  onOpenChange: (open: boolean) => void;
  onUpload: (file: File) => Promise<void> | void;
  open: boolean;
  registry?: ReturnType<typeof useSkillRegistry>;
}

export function UploadSkillDialog({ onOpenChange, onUpload, open, registry }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [prepared, setPrepared] = useState<{ file: File; preview: SkillInspectResult } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setPrepared(null);
    setError(null);
    setDragOver(false);
    setSubmitting(false);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  }

  async function handleFiles(files: FileList | null) {
    setError(null);
    if (!files || files.length === 0) {
      return;
    }
    const file = files[0]!;
    try {
      const preview = registry ? await registry.inspectFile(file) : null;

      if (!preview) {
        throw new Error("Skill inspect service is unavailable.");
      }

      setPrepared({ file, preview });
    } catch (caughtError) {
      setError(
        "Failed to inspect: " +
          (caughtError instanceof Error ? caughtError.message : String(caughtError)),
      );
    }
  }

  async function handleConfirm() {
    if (!prepared) {
      return;
    }
    setSubmitting(true);
    try {
      await onUpload(prepared.file);
      handleOpenChange(false);
    } catch (caughtError) {
      setError(
        "Failed to upload: " +
          (caughtError instanceof Error ? caughtError.message : String(caughtError)),
      );
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload skill</DialogTitle>
          <DialogDescription className="sr-only">
            Upload a .md, .zip, or .skill file to your personal skills.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept=".md,.zip,.skill"
          aria-label="Upload skill file"
          className="sr-only"
          onChange={(e) => {
            void handleFiles(e.target.files);
          }}
        />

        {prepared ? (
          <div className="border-border bg-muted/30 flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground font-mono text-xs">{prepared.file.name}</span>
            </div>
            <div>
              <div className="text-muted-foreground text-[11px] tracking-wider uppercase">Name</div>
              <div className="text-sm font-medium">{prepared.preview.frontmatter.name}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-[11px] tracking-wider uppercase">
                Description
              </div>
              <div className="text-foreground text-sm">
                {prepared.preview.frontmatter.description}
              </div>
            </div>
            {isTruthy(prepared.preview.frontmatter.author) ? (
              <div className="text-muted-foreground text-xs">
                by {prepared.preview.frontmatter.author}
              </div>
            ) : null}
          </div>
        ) : (
          <button
            className={cn(
              "group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-14 transition-colors",
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/60 hover:bg-muted/30",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => {
              setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void handleFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            <div className="text-foreground text-[15px] font-medium">
              Drag and drop or click to upload
            </div>
          </button>
        )}

        {isTruthy(error) ? (
          <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
            {error}
          </div>
        ) : null}

        {!prepared ? (
          <div className="space-y-2">
            <div className="text-foreground text-[13px] font-medium">File requirements</div>
            <ul className="text-muted-foreground marker:text-muted-foreground/60 list-disc space-y-1 pl-4 text-[12.5px]">
              <li>.md file must contain skill name and description formatted in YAML</li>
              <li>.zip or .skill file must include a SKILL.md file</li>
            </ul>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              handleOpenChange(false);
            }}
            disabled={submitting}
          >
            Cancel
          </Button>
          {prepared ? (
            <Button variant="outline" onClick={reset} disabled={submitting}>
              Change file
            </Button>
          ) : null}
          <Button disabled={!prepared || submitting} onClick={handleConfirm}>
            {submitting ? "Uploading…" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
