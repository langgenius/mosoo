import { CommandBlock } from "@/shared/ui/command-block";

import { useAppSession } from "../../app/session-provider";

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

// App-layer General settings. Read-only today: editing the App name and the
// Danger zone (pause / delete) need backend mutations that the web App client
// does not expose yet, so this surface only reflects the App's identity.
export function AppGeneralTab() {
  const { activeApp, appsLoading } = useAppSession();

  return (
    <>
      <header className="border-border-subtle flex h-12 shrink-0 items-center border-b px-5">
        <span className="text-sm font-medium">App</span>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[560px] p-6">
          {activeApp === null ? (
            <div className="text-muted-foreground text-sm">
              {appsLoading ? "Loading App…" : "No App available."}
            </div>
          ) : (
            <div className="space-y-6">
              <ReadonlyField label="App name" value={activeApp.name} />
              <div className="space-y-2">
                <div className="text-foreground text-sm font-medium">App ID</div>
                <p className="text-fg-2 text-[12px]">
                  The CLI and API use this id to target this App.
                </p>
                <CommandBlock command={activeApp.id} prompt={null} />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
