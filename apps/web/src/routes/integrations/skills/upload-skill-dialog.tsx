import type { SkillInspectResult } from "@mosoo/contracts/skill";
import { useReducer, useRef } from "react";

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
import { Input } from "@/shared/ui/input";

import { isTruthy } from "../../../shared/lib/truthiness";
import type { useSkillRegistry } from "./use-skill-registry";
type Mode = "file" | "url";

type Prepared =
  | { kind: "file"; file: File; preview: SkillInspectResult }
  | { kind: "url"; url: string; preview: SkillInspectResult };

interface UploadSkillState {
  dragOver: boolean;
  error: string | null;
  inspecting: boolean;
  mode: Mode;
  prepared: Prepared | null;
  submitting: boolean;
  url: string;
}

type UploadSkillAction =
  | { type: "clearError" }
  | { type: "inspectUrlStart" }
  | { type: "prepare"; prepared: Prepared }
  | { type: "reset" }
  | { type: "setDragOver"; dragOver: boolean }
  | { type: "setError"; error: string }
  | { type: "setMode"; mode: Mode }
  | { type: "setSubmitting"; submitting: boolean }
  | { type: "setUrl"; url: string };

const UPLOAD_SKILL_INITIAL_STATE: UploadSkillState = {
  dragOver: false,
  error: null,
  inspecting: false,
  mode: "file",
  prepared: null,
  submitting: false,
  url: "",
};

function uploadSkillReducer(state: UploadSkillState, action: UploadSkillAction): UploadSkillState {
  switch (action.type) {
    case "clearError":
      return { ...state, error: null };
    case "inspectUrlStart":
      return { ...state, error: null, inspecting: true };
    case "prepare":
      return { ...state, error: null, inspecting: false, prepared: action.prepared };
    case "reset":
      return UPLOAD_SKILL_INITIAL_STATE;
    case "setDragOver":
      return { ...state, dragOver: action.dragOver };
    case "setError":
      return { ...state, error: action.error, inspecting: false, submitting: false };
    case "setMode":
      return { ...state, error: null, mode: action.mode };
    case "setSubmitting":
      return { ...state, submitting: action.submitting };
    case "setUrl":
      return { ...state, url: action.url };
  }
}

interface Props {
  onOpenChange: (open: boolean) => void;
  onUpload: (file: File) => Promise<void> | void;
  onImportUrl: (url: string) => Promise<void> | void;
  open: boolean;
  registry?: ReturnType<typeof useSkillRegistry>;
}

export function UploadSkillDialog({ onImportUrl, onOpenChange, onUpload, open, registry }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, dispatch] = useReducer(uploadSkillReducer, UPLOAD_SKILL_INITIAL_STATE);
  const { dragOver, error, inspecting, mode, prepared, submitting, url } = state;

  function reset() {
    dispatch({ type: "reset" });
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
    dispatch({ type: "clearError" });
    if (!files || files.length === 0) {
      return;
    }
    const file = files[0]!;
    try {
      const preview = registry ? await registry.inspectFile(file) : null;

      if (!preview) {
        throw new Error("Skill inspect service is unavailable.");
      }

      dispatch({ prepared: { kind: "file", file, preview }, type: "prepare" });
    } catch (caughtError) {
      dispatch({
        error:
          "Failed to inspect: " +
          (caughtError instanceof Error ? caughtError.message : String(caughtError)),
        type: "setError",
      });
    }
  }

  async function handleInspectUrl() {
    const trimmed = url.trim();
    if (!trimmed) {
      dispatch({ type: "clearError" });
      return;
    }
    dispatch({ type: "inspectUrlStart" });
    try {
      const preview = registry ? await registry.inspectGithub(trimmed) : null;

      if (!preview) {
        throw new Error("Skill inspect service is unavailable.");
      }

      dispatch({ prepared: { kind: "url", preview, url: trimmed }, type: "prepare" });
    } catch (caughtError) {
      dispatch({
        error:
          "Failed to inspect: " +
          (caughtError instanceof Error ? caughtError.message : String(caughtError)),
        type: "setError",
      });
    }
  }

  async function handleConfirm() {
    if (!prepared) {
      return;
    }
    dispatch({ submitting: true, type: "setSubmitting" });
    try {
      if (prepared.kind === "file") {
        await onUpload(prepared.file);
      } else {
        await onImportUrl(prepared.url);
      }
      handleOpenChange(false);
    } catch (caughtError) {
      dispatch({
        error:
          "Failed to add skill: " +
          (caughtError instanceof Error ? caughtError.message : String(caughtError)),
        type: "setError",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add skill</DialogTitle>
          <DialogDescription className="sr-only">
            Upload a .md, .zip, or .skill file, or import a skill from a GitHub or skills.sh URL.
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

        {!prepared ? (
          <div className="border-border-strong bg-card inline-flex w-fit items-center overflow-hidden rounded-md border">
            <ModeButton
              active={mode === "file"}
              label="Upload file"
              onClick={() => {
                dispatch({ mode: "file", type: "setMode" });
              }}
            />
            <span className="bg-border-strong h-5 w-px" />
            <ModeButton
              active={mode === "url"}
              label="From URL"
              onClick={() => {
                dispatch({ mode: "url", type: "setMode" });
              }}
            />
          </div>
        ) : null}

        {prepared ? (
          <div className="border-border bg-muted/30 flex flex-col gap-3 rounded-lg border p-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground font-mono text-xs">
                {prepared.kind === "file" ? prepared.file.name : prepared.url}
              </span>
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
        ) : mode === "file" ? (
          <button
            className={cn(
              "group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-14 transition-colors",
              dragOver
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/60 hover:bg-muted/30",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              dispatch({ dragOver: true, type: "setDragOver" });
            }}
            onDragLeave={() => {
              dispatch({ dragOver: false, type: "setDragOver" });
            }}
            onDrop={(e) => {
              e.preventDefault();
              dispatch({ dragOver: false, type: "setDragOver" });
              void handleFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            <div className="text-foreground text-[15px] font-medium">
              Drag and drop or click to upload
            </div>
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input
                value={url}
                placeholder="https://github.com/owner/repo or npx skills add … --skill name"
                aria-label="Skill source URL or install command"
                onChange={(e) => {
                  dispatch({ type: "setUrl", url: e.target.value });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleInspectUrl();
                  }
                }}
              />
              <Button
                variant="outline"
                onClick={() => {
                  void handleInspectUrl();
                }}
                disabled={inspecting || url.trim().length === 0}
              >
                {inspecting ? "Checking…" : "Preview"}
              </Button>
            </div>
          </div>
        )}

        {isTruthy(error) ? (
          <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
            {error}
          </div>
        ) : null}

        {!prepared && mode === "file" ? (
          <div className="space-y-2">
            <div className="text-foreground text-[13px] font-medium">File requirements</div>
            <ul className="text-muted-foreground marker:text-muted-foreground/60 list-disc space-y-1 pl-4 text-[12.5px]">
              <li>.md file must contain skill name and description formatted in YAML</li>
              <li>.zip or .skill file must include a SKILL.md file</li>
            </ul>
          </div>
        ) : null}

        {!prepared && mode === "url" ? (
          <div className="space-y-2">
            <div className="text-foreground text-[13px] font-medium">Supported sources</div>
            <ul className="text-muted-foreground marker:text-muted-foreground/60 list-disc space-y-1 pl-4 text-[12.5px]">
              <li>A GitHub repo, directory, or SKILL.md link</li>
              <li>
                A{" "}
                <a
                  href="https://www.skills.sh/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  skills.sh
                </a>{" "}
                skill page URL
              </li>
              <li>
                The install command copied from skills.sh, e.g.{" "}
                <code className="font-mono text-[11.5px]">npx skills add …&nbsp;--skill name</code>
              </li>
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
              Change
            </Button>
          ) : null}
          <Button disabled={!prepared || submitting} onClick={handleConfirm}>
            {submitting ? "Adding…" : "Add skill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-8 px-3 text-[13px] font-medium transition-colors",
        active ? "bg-paper-200 text-fg-1" : "text-fg-3 hover:bg-paper-200/50",
      )}
    >
      {label}
    </button>
  );
}
