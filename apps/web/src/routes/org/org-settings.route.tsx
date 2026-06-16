import { useAppSession } from "@/app/session-provider";
import { PageHeader } from "@/shared/ui/page-header";

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-2">
      <div className="text-foreground text-sm font-medium">{label}</div>
      <div className="border-border bg-muted text-muted-foreground flex h-10 items-center rounded-lg border px-3 text-sm">
        {value}
      </div>
    </div>
  );
}

// Org-layer General settings — the account/billing shell's identity. Read-only:
// renaming the shell needs a backend mutation the web client does not expose.
export function OrgSettingsPage() {
  const { activeOrganization, organizationsLoading } = useAppSession();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title="Org settings" description="General details for this account shell." />

      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-[560px]">
          {activeOrganization === null ? (
            <div className="text-muted-foreground text-sm">
              {organizationsLoading ? "Loading…" : "No active organization."}
            </div>
          ) : (
            <div className="space-y-6">
              <ReadonlyField label="Name" value={activeOrganization.name} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
