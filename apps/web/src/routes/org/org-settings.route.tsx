import { useEffect, useState } from "react";

import { useAppSession } from "@/app/session-provider";
import { renameOrganization } from "@/domains/organization/api/organization-client";
import { useTranslation } from "@/shared/i18n";
import { isTruthy } from "@/shared/lib/truthiness";
import { Button } from "@/shared/ui/button";
import { CommandBlock } from "@/shared/ui/command-block";
import { Check, Loader2 } from "@/shared/ui/icons";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";

// Org-layer General settings — the account/billing shell's identity.
export function OrgSettingsPage() {
  const { t } = useTranslation();
  const { activeOrganization, organizationsLoading, refreshOrganizations } = useAppSession();

  const [name, setName] = useState(activeOrganization?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(activeOrganization?.name ?? "");
  }, [activeOrganization?.name]);

  const trimmedName = name.trim();
  const dirty = activeOrganization !== null && trimmedName !== activeOrganization.name;
  const canSave = dirty && trimmedName.length > 0 && !saving;

  async function handleSave() {
    if (!canSave || activeOrganization === null) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await renameOrganization({ organizationId: activeOrganization.id, name: trimmedName });
      await refreshOrganizations();
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
      }, 2000);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("org.renameFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
        <div className="max-w-[560px]">
          {activeOrganization === null ? (
            <div className="text-muted-foreground text-sm">
              {organizationsLoading ? t("common.loading") : t("common.noActiveOrganization")}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-1.5">
                <Label htmlFor="org-name">{t("org.name")}</Label>
                <Input
                  aria-label={t("org.organizationName")}
                  id="org-name"
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

              <div>
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

              <div className="space-y-2">
                <div className="text-fg-1 text-[13px] font-medium">{t("org.orgId")}</div>
                <p className="text-fg-3 text-[12px] leading-4">{t("org.orgIdDescription")}</p>
                <CommandBlock
                  command={activeOrganization.id}
                  copyLabel={t("org.copyOrgId")}
                  prompt={null}
                />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
