import type { SkillSummary } from "@mosoo/contracts/skill";
import { useMemo, useState } from "react";

import { useAppSkillsQuery, useSkillSourceQuery } from "@/domains/skill/query/skill-queries";

import type { SkillInfo } from "../../agent.types";

export interface AgentSkillsFieldModel {
  availablePersonalSkills: SkillSummary[];
  availableSharedSkills: SkillSummary[];
  availableSkills: SkillSummary[];
  handleAddSkill(skill: SkillSummary): void;
  handleRemoveSkill(skillId: string): void;
  previewContent: string;
  previewSkill: SkillInfo | null;
  setPreviewSkill(skill: SkillInfo | null): void;
  skillsError: unknown;
  skillsLoading: boolean;
}

function toSkillInfo(skill: SkillSummary): SkillInfo {
  return {
    filename: `${skill.id}.md`,
    id: skill.id,
    name: skill.name,
    state: "active",
  };
}

export function useAgentSkillsFieldModel({
  selectedSkills,
  setSkills,
  appId,
}: {
  selectedSkills: SkillInfo[];
  setSkills: (skills: SkillInfo[]) => void;
  appId: string | null;
}): AgentSkillsFieldModel {
  const [previewSkill, setPreviewSkill] = useState<SkillInfo | null>(null);
  const skillsQuery = useAppSkillsQuery(appId);
  const previewQuery = useSkillSourceQuery(
    appId,
    previewSkill?.state === "tombstone" ? null : (previewSkill?.id ?? null),
    previewSkill !== null && previewSkill.state !== "tombstone",
  );

  const selectedIds = useMemo(
    () => new Set(selectedSkills.map((skill) => skill.id)),
    [selectedSkills],
  );
  const availableSkills = (skillsQuery.data ?? []).filter((skill) => !selectedIds.has(skill.id));
  const availablePersonalSkills = availableSkills;
  const availableSharedSkills: SkillSummary[] = [];

  function handleAddSkill(skill: SkillSummary): void {
    setSkills([...selectedSkills, toSkillInfo(skill)]);
  }

  function handleRemoveSkill(skillId: string): void {
    setSkills(selectedSkills.filter((skill) => skill.id !== skillId));
  }

  return {
    availablePersonalSkills,
    availableSharedSkills,
    availableSkills,
    handleAddSkill,
    handleRemoveSkill,
    previewContent:
      previewSkill?.state === "tombstone"
        ? "This skill is no longer accessible and will be removed on the next save."
        : (previewQuery.data ?? "Loading skill source…"),
    previewSkill,
    setPreviewSkill,
    skillsError: skillsQuery.error,
    skillsLoading: skillsQuery.isLoading,
  };
}
