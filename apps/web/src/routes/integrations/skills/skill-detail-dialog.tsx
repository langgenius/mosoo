import type { SkillSummary } from "@mosoo/contracts/skill";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { getSkillDetail, skillPackageUrl } from "@/domains/skill/api/skill-client";
import { countSkillFiles } from "@/domains/skill/lib/skill-entries";
import { skillKeys, useSkillSourceQuery } from "@/domains/skill/query/skill-queries";
import { useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { documentMarkdownClassName, Markdown } from "@/shared/ui/markdown";
import { Separator } from "@/shared/ui/separator";
import { SkillFileCountBadge } from "@/shared/ui/skill-file-count-badge";

import { isTruthy } from "../../../shared/lib/truthiness";
import { DeleteSkillDialog } from "./delete-skill-dialog";
import type { useSkillRegistry } from "./use-skill-registry";
type Registry = ReturnType<typeof useSkillRegistry>;

interface Props {
  onOpenChange: (open: boolean) => void;
  registry: Registry;
  skill: SkillSummary;
}

export function SkillDetailDialog({ onOpenChange, registry, skill }: Props) {
  const { t } = useTranslation();
  const [actionError, setActionError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const detailQuery = useQuery({
    queryFn: async () => getSkillDetail(skill.projectId, skill.id),
    queryKey: [...skillKeys.all, "detail", skill.id],
  });
  const sourceQuery = useSkillSourceQuery(skill.projectId, skill.id);
  const contentError = detailQuery.error ?? sourceQuery.error;
  const body = useMemo(() => stripSkillFrontmatter(sourceQuery.data ?? ""), [sourceQuery.data]);

  async function handleFork() {
    if (forking) {
      return;
    }
    setActionError(null);
    setForking(true);

    try {
      await registry.createSkillFork(skill.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("skills.failedToFork"));
    } finally {
      setForking(false);
    }
  }

  function handleDownload() {
    globalThis.location.href = skillPackageUrl(skill.projectId, skill.id);
  }

  const detail = detailQuery.data ?? null;
  const displaySkill = detail ?? skill;
  const fileCount = detail === null ? skill.fileCount : countSkillFiles(detail.entries);

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(80vh,720px)] w-[calc(100vw-2rem)] flex-col gap-0 p-0 sm:max-w-[640px]">
          <DialogHeader className="space-y-2 px-6 pt-6 pr-14 pb-4 text-left">
            <div className="min-w-0">
              <DialogTitle className="flex items-baseline gap-2 text-[18px] font-semibold">
                <span className="truncate">{displaySkill.name}</span>
                <span className="text-fg-3 shrink-0 text-[13px] font-medium">
                  {t("skills.skill")}
                </span>
              </DialogTitle>
              {isTruthy(displaySkill.description) ? (
                <DialogDescription className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed">
                  {displaySkill.description}
                </DialogDescription>
              ) : null}
            </div>
          </DialogHeader>

          <Separator />

          <div className="text-foreground min-h-0 flex-1 overflow-y-auto px-6 py-5 text-[13.5px] leading-relaxed">
            <div className="mb-4 flex items-center gap-2">
              <span className="border-border bg-sunken/50 text-foreground inline-flex items-center rounded-md border px-2 py-1 font-mono text-[11px]">
                SKILL.md
              </span>
              <SkillFileCountBadge count={fileCount} />
            </div>
            {displaySkill.forkOrigin ? (
              <div className="bg-sunken/50 text-fg-3 mb-4 rounded-md px-2.5 py-1.5 text-[11px]">
                {t("skills.forkedFrom")}{" "}
                <span className="text-foreground font-medium">
                  {displaySkill.forkOrigin.ownerName} / {displaySkill.forkOrigin.name}
                </span>
              </div>
            ) : null}
            {detailQuery.isLoading || sourceQuery.isLoading ? (
              <p className="text-fg-3">{t("common.loading")}</p>
            ) : contentError ? (
              <p className="text-danger">
                {t("skills.failedToLoadContent", { error: contentError.message })}
              </p>
            ) : (
              <Markdown className={documentMarkdownClassName}>{body}</Markdown>
            )}
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-2 px-6 py-4">
            <div>
              {isTruthy(actionError) ? (
                <div className="border-danger/30 bg-danger/5 text-danger rounded-md border px-3 py-2 text-xs">
                  {actionError}
                </div>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowDelete(true);
                }}
                className="text-danger hover:bg-danger/10 hover:text-danger border-danger/30"
              >
                {t("skills.uninstall")}
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={handleDownload}>
                {t("skills.download")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleFork()}
                disabled={forking}
              >
                {forking ? t("skills.forking") : t("skills.fork")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {showDelete ? (
        <DeleteSkillDialog
          skill={skill}
          open
          onOpenChange={setShowDelete}
          registry={registry}
          onDeleted={() => {
            setShowDelete(false);
            onOpenChange(false);
          }}
        />
      ) : null}
    </>
  );
}

function stripSkillFrontmatter(raw: string): string {
  const normalized = raw.replaceAll("\r\n", "\n").trim();

  if (!normalized.startsWith("---")) {
    return raw;
  }

  const withoutOpener = normalized.slice(3);
  const closerIndex = withoutOpener.indexOf("\n---");

  if (closerIndex === -1) {
    return raw;
  }

  return withoutOpener.slice(closerIndex + 4).replace(/^\n+/, "");
}
