import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useAppSession } from "@/app/session-provider";
import { renameOrganization } from "@/domains/organization/api/organization-client";
import { isTruthy } from "@/shared/lib/truthiness";
import { Button } from "@/shared/ui/button";

// Org-layer General settings — the account/billing shell's identity.
export function OrgSettingsPage() {
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
      setError(nextError instanceof Error ? nextError.message : "Failed to rename organization.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-[560px]">
          {activeOrganization === null ? (
            <div className="text-muted-foreground text-sm">
              {organizationsLoading ? "Loading…" : "No active organization."}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-foreground text-sm font-medium" htmlFor="org-name">
                  Name
                </label>
                <input
                  aria-label="Organization name"
                  id="org-name"
                  type="text"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  className="border-border bg-background text-foreground focus:ring-primary/20 focus:border-primary disabled:bg-muted disabled:text-muted-foreground h-10 w-full rounded-lg border px-3 text-sm transition-colors focus:ring-2 focus:outline-none disabled:cursor-not-allowed"
                />
                {isTruthy(error) ? <p className="text-destructive text-[12px]">{error}</p> : null}
              </div>

              <div>
                <Button onClick={() => void handleSave()} disabled={!canSave} size="sm">
                  {saving ? (
                    <>
                      <Loader2 className="mr-1 size-4 animate-spin" /> Saving…
                    </>
                  ) : saved ? (
                    <>
                      <Check className="mr-1 size-4" /> Saved
                    </>
                  ) : (
                    "Save changes"
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
