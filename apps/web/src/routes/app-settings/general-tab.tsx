import type { AppSummary } from "@mosoo/contracts/app";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { useAppSession } from "@/app/session-provider";
import { renameApp } from "@/domains/app/api/app-client";
import { appKeys } from "@/domains/app/query/app-queries";
import { toAppId } from "@/routes/typed-id";
import { useTranslation } from "@/shared/i18n";
import { isTruthy } from "@/shared/lib/truthiness";
import { Button } from "@/shared/ui/button";
import { CommandBlock } from "@/shared/ui/command-block";

import { SettingsTabBody, SettingsTabHeader } from "../settings/settings-tab-layout";

export function GeneralTab() {
  const { activeApp } = useAppSession();
  const formKey = activeApp === null ? "no-app" : `${activeApp.id}:${activeApp.name}`;

  return <GeneralForm key={formKey} activeApp={activeApp} />;
}

function GeneralForm({ activeApp }: { activeApp: AppSummary | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [name, setName] = useState(activeApp?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const dirty = activeApp !== null && trimmedName !== activeApp.name;
  const canSave = dirty && trimmedName.length > 0 && !saving;

  async function handleSave() {
    if (!canSave || activeApp === null) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await renameApp({ appId: toAppId(activeApp.id), name: trimmedName });
      await queryClient.invalidateQueries({ queryKey: appKeys.lists() });
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
        <div className="space-y-2">
          <label className="text-foreground text-sm font-medium" htmlFor="app-name">
            {t("settings.appName")}
          </label>
          <p className="text-fg-2 text-[12px]">{t("settings.appDescription")}</p>
          <input
            aria-label={t("settings.appName")}
            id="app-name"
            type="text"
            value={name}
            disabled={activeApp === null}
            onChange={(event) => {
              setName(event.target.value);
            }}
            className="border-border bg-background text-foreground focus:ring-primary/20 focus:border-primary disabled:bg-muted disabled:text-muted-foreground h-10 w-full rounded-lg border px-3 text-sm transition-colors focus:ring-2 focus:outline-none disabled:cursor-not-allowed"
          />
          {isTruthy(error) ? <p className="text-destructive text-[12px]">{error}</p> : null}
        </div>

        <div className="mt-6">
          <Button onClick={() => void handleSave()} disabled={!canSave} size="sm">
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

        {activeApp === null ? null : (
          <div className="mt-8 space-y-6">
            <div className="space-y-2">
              <div className="text-foreground text-sm font-medium">{t("agent.appId")}</div>
              <p className="text-fg-2 text-[12px]">{t("appSettings.appIdDescription")}</p>
              <CommandBlock command={activeApp.id} prompt={null} />
            </div>
          </div>
        )}
      </SettingsTabBody>
    </>
  );
}
