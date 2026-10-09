import type { SkillInspectResult } from "@mosoo/contracts/skill";
import { useRef, useState } from "react";

import { useTranslation } from "@/shared/i18n";
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
import { SkillFileCountBadge } from "@/shared/ui/skill-file-count-badge";

import { inspectSkillUpload } from "../../../domains/skill/api/skill-client";
import { countSkillFiles } from "../../../domains/skill/lib/skill-entries";
import type { SkillFolderSelection } from "../../../domains/skill/lib/skill-folder-archive";
import {
  createSkillFolderArchiveFile,
  readDroppedFolderSelection,
  readFolderInputSelection,
} from "../../../domains/skill/lib/skill-folder-archive";
import { isTruthy } from "../../../shared/lib/truthiness";
type Mode = "file" | "url";

type Prepared =
  | { kind: "file"; file: File; preview: SkillInspectResult }
  | { kind: "url"; url: string; preview: SkillInspectResult };

interface Props {
  onOpenChange: (open: boolean) => void;
  onUpload: (file: File) => Promise<void> | void;
  onImportUrl: (url: string) => Promise<void> | void;
  open: boolean;
}

export function UploadSkillDialog({ onImportUrl, onOpenChange, onUpload, open }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [mode, setMode] = useState<Mode>("file");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [url, setUrl] = useState("");

  // A failure ends whatever step was running.
  function fail(message: string) {
    setError(message);
    setInspecting(false);
    setSubmitting(false);
  }

  function prepare(next: Prepared) {
    setError(null);
    setInspecting(false);
    setPrepared(next);
  }

  function reset() {
    setError(null);
    setInspecting(false);
    setMode("file");
    setPrepared(null);
    setSubmitting(false);
    setUrl("");
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
    }
    onOpenChange(next);
  }

  async function inspectFile(file: File) {
    prepare({ kind: "file", file, preview: await inspectSkillUpload({ file }) });
  }

  function failInspect(caughtError: unknown) {
    fail(
      t("skills.failedToInspect", {
        error: caughtError instanceof Error ? caughtError.message : String(caughtError),
      }),
    );
  }

  async function handleFiles(files: FileList | null) {
    setError(null);
    if (!files || files.length === 0) {
      return;
    }
    const file = files[0]!;
    try {
      await inspectFile(file);
    } catch (caughtError) {
      failInspect(caughtError);
    }
  }

  async function handleFolder(loadSelection: () => Promise<SkillFolderSelection | null>) {
    setError(null);
    try {
      const selection = await loadSelection();

      if (!selection) {
        return;
      }

      const archive = await createSkillFolderArchiveFile(selection);
      await inspectFile(archive);
    } catch (caughtError) {
      failInspect(caughtError);
    }
  }

  async function handleInspectUrl() {
    const trimmed = url.trim();
    setError(null);
    if (!trimmed) {
      return;
    }
    setInspecting(true);
    try {
      prepare({
        kind: "url",
        preview: await inspectSkillUpload({ githubUrl: trimmed }),
        url: trimmed,
      });
    } catch (caughtError) {
      failInspect(caughtError);
    }
  }

  async function handleConfirm() {
    if (!prepared) {
      return;
    }
    setSubmitting(true);
    try {
      if (prepared.kind === "file") {
        await onUpload(prepared.file);
      } else {
        await onImportUrl(prepared.url);
      }
      handleOpenChange(false);
    } catch (caughtError) {
      fail(
        t("skills.failedToAdd", {
          error: caughtError instanceof Error ? caughtError.message : String(caughtError),
        }),
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("skills.addSkill")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("skills.uploadDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept=".md,.zip,.skill"
          aria-label={t("skills.uploadSkillFile")}
          className="sr-only"
          onChange={(e) => {
            void handleFiles(e.target.files);
          }}
        />

        <input
          ref={(element) => {
            folderInputRef.current = element;
            if (element !== null) {
              element.webkitdirectory = true;
            }
          }}
          type="file"
          aria-label={t("skills.uploadSkillFolder")}
          className="sr-only"
          onChange={(e) => {
            const files = e.target.files;
            void handleFolder(() => Promise.resolve(readFolderInputSelection(files)));
          }}
        />

        {!prepared ? (
          <div className="border-border-strong bg-card inline-flex w-fit items-center overflow-hidden rounded-md border">
            <ModeButton
              active={mode === "file"}
              label={t("skills.uploadFile")}
              onClick={() => {
                setError(null);
                setMode("file");
              }}
            />
            <span className="bg-border-strong h-5 w-px" />
            <ModeButton
              active={mode === "url"}
              label={t("skills.fromUrl")}
              onClick={() => {
                setError(null);
                setMode("url");
              }}
            />
          </div>
        ) : null}

        {prepared ? (
          <div className="border-border bg-sunken/30 flex min-w-0 flex-col gap-3 rounded-lg border p-4">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <span className="text-fg-3 min-w-0 flex-1 font-mono text-xs break-all">
                {prepared.kind === "file" ? prepared.file.name : prepared.url}
              </span>
              <SkillFileCountBadge count={countSkillFiles(prepared.preview.entries)} />
            </div>
            <div>
              <div className="t-group-label">{t("skills.name")}</div>
              <div className="text-sm font-medium">{prepared.preview.frontmatter.name}</div>
            </div>
            <div>
              <div className="t-group-label">{t("skills.descriptionLabel")}</div>
              <div className="text-foreground text-sm">
                {prepared.preview.frontmatter.description}
              </div>
            </div>
            {isTruthy(prepared.preview.frontmatter.author) ? (
              <div className="text-fg-3 text-xs">
                {t("skills.byAuthor", { author: prepared.preview.frontmatter.author })}
              </div>
            ) : null}
          </div>
        ) : mode === "file" ? (
          <div className="flex flex-col gap-2">
            <button
              className={cn(
                "group flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed py-14 transition-colors",
                dragOver
                  ? "border-emphasis bg-selected"
                  : "border-border hover:border-border-strong hover:bg-hover",
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
                const entry =
                  e.dataTransfer.items.length === 1
                    ? e.dataTransfer.items[0]?.webkitGetAsEntry()
                    : null;

                if (entry?.isDirectory) {
                  const directory = entry as FileSystemDirectoryEntry;
                  void handleFolder(() => readDroppedFolderSelection(directory));
                } else {
                  void handleFiles(e.dataTransfer.files);
                }
              }}
              onClick={() => inputRef.current?.click()}
              type="button"
            >
              <div className="text-foreground text-[15px] font-medium">
                {t("skills.dragAndDrop")}
              </div>
              <div className="text-fg-3 text-xs">{t("skills.dropFileOrFolder")}</div>
            </button>
            <div className="text-fg-3 text-center text-xs">
              {t("skills.or")}{" "}
              <button
                type="button"
                className="text-link hover:text-link-hover underline underline-offset-2"
                onClick={() => folderInputRef.current?.click()}
              >
                {t("skills.selectAFolder")}
              </button>{" "}
              {t("skills.fromYourComputer")}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input
                value={url}
                placeholder="https://github.com/owner/repo or npx skills add … --skill name"
                aria-label={t("skills.sourceUrlPlaceholder")}
                onChange={(e) => {
                  setUrl(e.target.value);
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
                {inspecting ? t("skills.checking") : t("skills.preview")}
              </Button>
            </div>
          </div>
        )}

        {isTruthy(error) ? (
          <div className="border-danger/30 bg-danger/5 text-danger rounded-md border px-3 py-2 text-xs">
            {error}
          </div>
        ) : null}

        {!prepared && mode === "file" ? (
          <div className="space-y-2">
            <div className="text-foreground text-[13px] font-medium">
              {t("skills.fileRequirements")}
            </div>
            <ul className="text-fg-3 marker:text-fg-3/60 list-disc space-y-1 pl-4 text-[12.5px]">
              <li>{t("skills.fileRequirementMd")}</li>
              <li>{t("skills.fileRequirementArchive")}</li>
              <li>{t("skills.folderMustIncludeSkillMd")}</li>
            </ul>
          </div>
        ) : null}

        {!prepared && mode === "url" ? (
          <div className="space-y-2">
            <div className="text-foreground text-[13px] font-medium">
              {t("skills.supportedSources")}
            </div>
            <ul className="text-fg-3 marker:text-fg-3/60 list-disc space-y-1 pl-4 text-[12.5px]">
              <li>{t("skills.githubRepoLink")}</li>
              <li>
                <a
                  href="https://www.skills.sh/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-link hover:text-link-hover underline underline-offset-2"
                >
                  {t("skills.skillPageUrl")}
                </a>
              </li>
              <li>
                {t("skills.installCommandExample")}{" "}
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
            {t("common.cancel")}
          </Button>
          {prepared ? (
            <Button variant="outline" onClick={reset} disabled={submitting}>
              {t("skills.change")}
            </Button>
          ) : null}
          <Button disabled={!prepared || submitting} onClick={handleConfirm}>
            {submitting ? t("skills.adding") : t("skills.addSkill")}
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
