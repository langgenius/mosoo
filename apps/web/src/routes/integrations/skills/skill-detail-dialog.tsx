import type { SkillDetail, SkillSummary } from "@mosoo/contracts/skill";
import { useEffect, useMemo, useState } from "react";

import { skillPackageUrl } from "@/domains/skill/api/skill-client";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Separator } from "@/shared/ui/separator";
import { StaticMarkdown } from "@/shared/ui/static-markdown";

import { isTruthy } from "../../../shared/lib/truthiness";
import { DeleteSkillDialog } from "./delete-skill-dialog";
import { ShareSkillDialog } from "./share-skill-dialog";
import type { useSkillRegistry } from "./use-skill-registry";
type Registry = ReturnType<typeof useSkillRegistry>;

interface Props {
  onOpenChange: (open: boolean) => void;
  registry: Registry;
  skill: SkillSummary;
}

export function SkillDetailDialog({ onOpenChange, registry, skill }: Props) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [content, setContent] = useState("");
  const [contentLoading, setContentLoading] = useState(true);
  const [contentError, setContentError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();
    void (async () => {
      try {
        const [nextDetail, text] = await Promise.all([
          registry.getSkillDetail(skill.id),
          registry.getSkillSource(skill.id),
        ]);
        if (abortController.signal.aborted) {
          return;
        }
        setDetail(nextDetail);
        setContent(text);
      } catch (error) {
        if (!abortController.signal.aborted) {
          setContentError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!abortController.signal.aborted) {
          setContentLoading(false);
        }
      }
    })();
    return () => {
      abortController.abort();
    };
  }, [registry.getSkillDetail, registry.getSkillSource, skill.id]);

  const body = useMemo(() => stripSkillFrontmatter(content), [content]);

  async function handleFork() {
    if (forking) {
      return;
    }
    setActionError(null);
    setForking(true);

    try {
      await registry.createSkillFork(skill.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Failed to fork skill.");
    } finally {
      setForking(false);
    }
  }

  function handleDownload() {
    globalThis.location.href = skillPackageUrl(skill.id);
  }

  const canManageSkill = skill.role === "owner";
  const displaySkill = detail ?? skill;

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(80vh,720px)] w-[calc(100vw-2rem)] flex-col gap-0 p-0 sm:max-w-[640px] sm:rounded-xl">
          <DialogHeader className="space-y-2 px-6 pt-6 pr-14 pb-4 text-left">
            <div className="min-w-0">
              <DialogTitle className="flex items-baseline gap-2 text-[18px] font-semibold">
                <span className="truncate">{displaySkill.name}</span>
                <span className="text-muted-foreground shrink-0 text-[13px] font-medium">
                  Skill
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
            {displaySkill.forkOrigin ? (
              <div className="bg-muted/50 text-muted-foreground mb-4 rounded-md px-2.5 py-1.5 text-[11px]">
                Forked from{" "}
                <span className="text-foreground font-medium">
                  {displaySkill.forkOrigin.ownerName} / {displaySkill.forkOrigin.name}
                </span>
              </div>
            ) : null}
            {contentLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : isTruthy(contentError) ? (
              <p className="text-destructive">Failed to load content: {contentError}</p>
            ) : (
              <StaticMarkdown>{body}</StaticMarkdown>
            )}
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-2 px-6 py-4">
            <div>
              {isTruthy(actionError) ? (
                <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-xs">
                  {actionError}
                </div>
              ) : null}
              {canManageSkill ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowDelete(true);
                  }}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                >
                  Uninstall
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              {canManageSkill ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowShare(true);
                  }}
                >
                  Share
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={handleDownload}>
                Download
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleFork()}
                disabled={forking}
              >
                {forking ? "Forking..." : "Fork"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {canManageSkill ? (
        <>
          {showShare ? (
            <ShareSkillDialog
              skill={skill}
              open={showShare}
              onOpenChange={setShowShare}
              registry={registry}
            />
          ) : null}
          {showDelete ? (
            <DeleteSkillDialog
              skill={skill}
              open={showDelete}
              onOpenChange={setShowDelete}
              registry={registry}
              onDeleted={() => {
                setShowDelete(false);
                onOpenChange(false);
              }}
            />
          ) : null}
        </>
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
