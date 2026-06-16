import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useAppSession } from "@/app/session-provider";
import { renameApp } from "@/domains/app/api/app-client";
import { appKeys } from "@/domains/app/query/app-queries";
import { renameOrganization } from "@/domains/organization/api/organization-client";
import { toAppId, toOrganizationId } from "@/routes/typed-id";
import { isTruthy } from "@/shared/lib/truthiness";
import { Button } from "@/shared/ui/button";

const INPUT_CLASS_NAME =
  "border-border bg-background text-foreground focus:ring-primary/20 focus:border-primary h-10 w-full rounded-lg border px-3 text-sm transition-colors focus:ring-2 focus:outline-none disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed";

function SaveButton({ saved, saving }: { saved: boolean; saving: boolean }) {
  if (saving) {
    return (
      <>
        <Loader2 className="mr-1 size-4 animate-spin" /> Saving…
      </>
    );
  }

  if (saved) {
    return (
      <>
        <Check className="mr-1 size-4" /> Saved
      </>
    );
  }

  return <>Save changes</>;
}

export function WorkspaceTab() {
  const { activeApp, activeOrganization, refreshOrganizations } = useAppSession();
  const queryClient = useQueryClient();

  const [orgName, setOrgName] = useState(activeOrganization?.name ?? "");
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgSaved, setOrgSaved] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);

  const [appName, setAppName] = useState(activeApp?.name ?? "");
  const [appSaving, setAppSaving] = useState(false);
  const [appSaved, setAppSaved] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);

  useEffect(() => {
    setOrgName(activeOrganization?.name ?? "");
  }, [activeOrganization?.name]);

  useEffect(() => {
    setAppName(activeApp?.name ?? "");
  }, [activeApp?.name]);

  const trimmedOrgName = orgName.trim();
  const orgDirty = activeOrganization !== null && trimmedOrgName !== activeOrganization.name;
  const canSaveOrg = orgDirty && trimmedOrgName.length > 0 && !orgSaving;

  const trimmedAppName = appName.trim();
  const appDirty = activeApp !== null && trimmedAppName !== activeApp.name;
  const canSaveApp = appDirty && trimmedAppName.length > 0 && !appSaving;

  async function handleSaveOrg() {
    if (!canSaveOrg || activeOrganization === null) {
      return;
    }

    setOrgSaving(true);
    setOrgError(null);

    try {
      await renameOrganization({
        name: trimmedOrgName,
        organizationId: toOrganizationId(activeOrganization.id),
      });
      await refreshOrganizations();
      setOrgSaved(true);
      setTimeout(() => {
        setOrgSaved(false);
      }, 2000);
    } catch (nextError) {
      setOrgError(
        nextError instanceof Error ? nextError.message : "Failed to rename organization.",
      );
    } finally {
      setOrgSaving(false);
    }
  }

  async function handleSaveApp() {
    if (!canSaveApp || activeApp === null) {
      return;
    }

    setAppSaving(true);
    setAppError(null);

    try {
      await renameApp({ appId: toAppId(activeApp.id), name: trimmedAppName });
      await queryClient.invalidateQueries({ queryKey: appKeys.lists() });
      setAppSaved(true);
      setTimeout(() => {
        setAppSaved(false);
      }, 2000);
    } catch (nextError) {
      setAppError(nextError instanceof Error ? nextError.message : "Failed to rename app.");
    } finally {
      setAppSaving(false);
    }
  }

  return (
    <>
      <header className="border-border-subtle flex h-12 shrink-0 items-center border-b px-5">
        <span className="text-sm font-medium">Workspace</span>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[520px] p-6">
          <div className="space-y-2">
            <label className="text-foreground text-sm font-medium" htmlFor="organization-name">
              Organization name
            </label>
            <p className="text-fg-2 text-[12px]">
              The account and billing shell that owns your Apps.
            </p>
            <input
              aria-label="Organization name"
              id="organization-name"
              type="text"
              value={orgName}
              disabled={activeOrganization === null}
              onChange={(event) => {
                setOrgName(event.target.value);
              }}
              className={INPUT_CLASS_NAME}
            />
            {isTruthy(orgError) ? <p className="text-destructive text-[12px]">{orgError}</p> : null}
            <div className="pt-1">
              <Button onClick={() => void handleSaveOrg()} disabled={!canSaveOrg} size="sm">
                <SaveButton saved={orgSaved} saving={orgSaving} />
              </Button>
            </div>
          </div>

          <div className="mt-8 space-y-2">
            <label className="text-foreground text-sm font-medium" htmlFor="app-name">
              App name
            </label>
            <p className="text-fg-2 text-[12px]">
              The App is your engineering and delivery boundary for Agents and resources.
            </p>
            <input
              aria-label="App name"
              id="app-name"
              type="text"
              value={appName}
              disabled={activeApp === null}
              onChange={(event) => {
                setAppName(event.target.value);
              }}
              className={INPUT_CLASS_NAME}
            />
            {isTruthy(appError) ? <p className="text-destructive text-[12px]">{appError}</p> : null}
            <div className="pt-1">
              <Button onClick={() => void handleSaveApp()} disabled={!canSaveApp} size="sm">
                <SaveButton saved={appSaved} saving={appSaving} />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
