import type { ProjectSummary } from "@mosoo/contracts/project";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useActiveProject } from "@/app/session/session-context";
import { renameProject } from "@/domains/project/api/project-client";
import { projectKeys } from "@/domains/project/query/project-queries";
import { useTranslation } from "@/shared/i18n";
import { isTruthy } from "@/shared/lib/truthiness";
import { Button } from "@/shared/ui/button";
import { CommandBlock } from "@/shared/ui/command-block";
import { Check, Loader2 } from "@/shared/ui/icons";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

import { SettingsTabBody, SettingsTabHeader } from "../settings/settings-tab-layout";

export function GeneralTab() {
  const project = useActiveProject();

  return <GeneralForm key={project.id} project={project} />;
}

function GeneralForm({ project }: { project: ProjectSummary }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const canSave = trimmedName !== project.name && trimmedName.length > 0 && !saving;

  async function handleSave() {
    if (!canSave) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await renameProject({ projectId: project.id, name: trimmedName });
      await queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
      }, 2000);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("settings.renameFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SettingsTabHeader title={t("settings.general")} />
      <SettingsTabBody>
        <div className="space-y-1.5">
          <Label htmlFor="project-name">{t("settings.projectName")}</Label>
          <p className="text-fg-3 text-[12px] leading-4">{t("settings.projectDescription")}</p>
          <Input
            aria-label={t("settings.projectName")}
            id="project-name"
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          {isTruthy(error) ? (
            <p className="text-danger-fg text-[12px]" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-6">
          <Button
            aria-busy={saving || undefined}
            disabled={!canSave}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <>
                <Loader2 className="mr-1 size-4 animate-spin" /> {t("settings.saving")}
              </>
            ) : saved ? (
              <>
                <Check className="mr-1 size-4" /> {t("settings.saved")}
              </>
            ) : (
              t("settings.saveChanges")
            )}
          </Button>
        </div>

        <div className="mt-8 space-y-6">
          <div className="space-y-2">
            <div className="text-fg-1 text-[13px] font-medium">{t("agent.projectId")}</div>
            <p className="text-fg-3 text-[12px] leading-4">
              {t("projectSettings.projectIdDescription")}
            </p>
            <CommandBlock command={project.id} prompt={null} />
          </div>
        </div>
      </SettingsTabBody>
    </>
  );
}
