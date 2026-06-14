import type { SkillDetail, SkillSummary } from "@mosoo/contracts/skill";
import { useEffect, useMemo, useReducer } from "react";

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
import type { useSkillRegistry } from "./use-skill-registry";
type Registry = ReturnType<typeof useSkillRegistry>;

interface Props {
  onOpenChange: (open: boolean) => void;
  registry: Registry;
  skill: SkillSummary;
}

interface SkillDetailDialogState {
  actionError: string | null;
  content: string;
  contentError: string | null;
  contentLoading: boolean;
  detail: SkillDetail | null;
  forking: boolean;
  showDelete: boolean;
}

type SkillDetailDialogAction =
  | { type: "contentFailed"; error: string }
  | { type: "contentLoaded"; content: string; detail: SkillDetail }
  | { type: "setActionError"; error: string | null }
  | { type: "setForking"; forking: boolean }
  | { type: "setShowDelete"; open: boolean };

const SKILL_DETAIL_DIALOG_INITIAL_STATE: SkillDetailDialogState = {
  actionError: null,
  content: "",
  contentError: null,
  contentLoading: true,
  detail: null,
  forking: false,
  showDelete: false,
};

function skillDetailDialogReducer(
  state: SkillDetailDialogState,
  action: SkillDetailDialogAction,
): SkillDetailDialogState {
  switch (action.type) {
    case "contentFailed":
      return { ...state, contentError: action.error, contentLoading: false };
    case "contentLoaded":
      return {
        ...state,
        content: action.content,
        contentLoading: false,
        detail: action.detail,
      };
    case "setActionError":
      return { ...state, actionError: action.error };
    case "setForking":
      return { ...state, forking: action.forking };
    case "setShowDelete":
      return { ...state, showDelete: action.open };
  }
}

export function SkillDetailDialog({ onOpenChange, registry, skill }: Props) {
  const [state, dispatch] = useReducer(skillDetailDialogReducer, SKILL_DETAIL_DIALOG_INITIAL_STATE);
  const { actionError, content, contentError, contentLoading, detail, forking, showDelete } = state;

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
        dispatch({ content: text, detail: nextDetail, type: "contentLoaded" });
      } catch (error) {
        if (!abortController.signal.aborted) {
          dispatch({
            error: error instanceof Error ? error.message : String(error),
            type: "contentFailed",
          });
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
    dispatch({ error: null, type: "setActionError" });
    dispatch({ forking: true, type: "setForking" });

    try {
      await registry.createSkillFork(skill.id);
    } catch (error) {
      dispatch({
        error: error instanceof Error ? error.message : "Failed to fork skill.",
        type: "setActionError",
      });
    } finally {
      dispatch({ forking: false, type: "setForking" });
    }
  }

  function handleDownload() {
    globalThis.location.href = skillPackageUrl(skill.appId, skill.id);
  }

  const canManageSkill = true;
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
                    dispatch({ open: true, type: "setShowDelete" });
                  }}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
                >
                  Uninstall
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
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
          {showDelete ? (
            <DeleteSkillDialog
              skill={skill}
              open={showDelete}
              onOpenChange={(open) => {
                dispatch({ open, type: "setShowDelete" });
              }}
              registry={registry}
              onDeleted={() => {
                dispatch({ open: false, type: "setShowDelete" });
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
