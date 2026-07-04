import type { SkillSummary } from "@mosoo/contracts/skill";
import { ChevronDown, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import type { SkillInfo } from "../../agent.types";
import { MarkdownPreviewDialog } from "./markdown-preview-dialog";
import { useAgentSkillsFieldModel } from "./use-skills-field-model";

interface AgentSkillsFieldProps {
  appId: string | null;
  readOnly?: boolean;
  selectedSkills: SkillInfo[];
  setSkills(skills: SkillInfo[]): void;
}

function MissingSkillBadge(): ReactElement {
  return (
    <span className="bg-amber-bg text-amber-fg rounded-md px-1.5 py-0.5 text-[10px] font-medium">
      Missing
    </span>
  );
}

export function AgentSkillsField({
  readOnly = false,
  selectedSkills,
  setSkills,
  appId,
}: AgentSkillsFieldProps): ReactElement {
  const model = useAgentSkillsFieldModel({
    appId,
    selectedSkills,
    setSkills,
  });
  const [open, setOpen] = useState(false);

  const noOptions = model.availableSkills.length === 0;
  const triggerLabel = model.skillsLoading ? "Loading skills…" : "Add skill";
  const handleAddSkill = (skill: SkillSummary): void => {
    model.handleAddSkill(skill);
    setOpen(false);
  };
  const dropdownContent = renderSkillsDropdownContent({
    model,
    noOptions,
    onAdd: handleAddSkill,
    selectedSkills,
  });

  return (
    <div>
      {selectedSkills.length > 0 ? (
        <div className="space-y-1.5">
          {selectedSkills.map((skill) => (
            <div
              key={skill.id}
              className="group hover:bg-accent/30 flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
            >
              <button
                className="min-w-0 flex-1 cursor-pointer bg-transparent p-0 text-left"
                onClick={() => {
                  model.setPreviewSkill(skill);
                }}
                type="button"
              >
                <div className="flex items-center gap-2">
                  <div className="text-foreground truncate text-[13px] font-medium">
                    {skill.name}
                  </div>
                  {skill.state === "tombstone" ? <MissingSkillBadge /> : null}
                </div>
                <div className="text-muted-foreground font-mono text-[11px]">{skill.filename}</div>
              </button>
              {!readOnly ? (
                <button
                  className="text-muted-foreground hover:text-destructive text-xs font-medium opacity-0 transition-colors group-hover:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    model.handleRemoveSkill(skill.id);
                  }}
                  type="button"
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {!readOnly ? (
        <div className="mt-2">
          <DropdownMenu onOpenChange={setOpen} open={open}>
            <DropdownMenuTrigger asChild>
              <Button
                className="w-full justify-between"
                disabled={model.skillsLoading}
                type="button"
                variant="outline"
              >
                <span className="text-foreground truncate text-left text-[13px] font-medium">
                  {triggerLabel}
                </span>
                <ChevronDown className="text-muted-foreground size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-[320px] w-[var(--anchor-width)] overflow-y-auto"
            >
              {dropdownContent}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link
                  className="text-muted-foreground flex w-full items-center gap-1.5 text-[12px]"
                  to="/integrations/skills"
                >
                  <ExternalLink className="size-3" />
                  Manage skills
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}

      {model.previewSkill ? (
        <MarkdownPreviewDialog
          content={model.previewContent}
          onOpenChange={() => {
            model.setPreviewSkill(null);
          }}
          open={model.previewSkill !== null}
          title={model.previewSkill.filename}
        />
      ) : null}
    </div>
  );
}

function renderSkillsDropdownContent({
  model,
  noOptions,
  onAdd,
  selectedSkills,
}: {
  model: ReturnType<typeof useAgentSkillsFieldModel>;
  noOptions: boolean;
  onAdd(skill: SkillSummary): void;
  selectedSkills: SkillInfo[];
}): ReactElement {
  if (model.skillsError) {
    return (
      <div className="text-destructive p-3 text-[12px]">
        {model.skillsError instanceof Error ? model.skillsError.message : "Failed to load skills."}
      </div>
    );
  }

  if (noOptions) {
    const message =
      selectedSkills.length === 0
        ? "No skills available. Head to Manage skills to upload one."
        : "All available skills are already added.";

    return <div className="text-muted-foreground p-3 text-[12px]">{message}</div>;
  }

  return (
    <>
      <SkillPickerGroup label="App skills" onAdd={onAdd} skills={model.availablePersonalSkills} />
    </>
  );
}

function SkillPickerGroup({
  label,
  onAdd,
  skills,
}: {
  label: string;
  onAdd: (skill: SkillSummary) => void;
  skills: SkillSummary[];
}): ReactElement | null {
  if (skills.length === 0) {
    return null;
  }

  return (
    <>
      <DropdownMenuLabel className="text-muted-foreground text-[10px] tracking-wider uppercase">
        {label}
      </DropdownMenuLabel>
      {skills.map((skill) => (
        <DropdownMenuItem
          className="gap-2 py-2"
          key={skill.id}
          onClick={() => {
            onAdd(skill);
          }}
        >
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{skill.name}</span>
          <span className="text-muted-foreground shrink-0 text-[11px]">{skill.ownerName}</span>
        </DropdownMenuItem>
      ))}
    </>
  );
}
