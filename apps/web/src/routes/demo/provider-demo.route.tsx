import { Permission, can } from "@mosoo/contracts/permission";
import { PUBLIC_RUNTIME_CATALOG } from "@mosoo/runtime-catalog";
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

import { RuntimeIcon, hasRuntimeIcon } from "@/shared/ui/brand-icons";
import { Button } from "@/shared/ui/button";

import { useAppSession } from "../../app/session-provider";

export function ProviderDemoPage(): ReactElement {
  const { activeOrganization: organization } = useAppSession();

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-5xl space-y-6">
        <div>
          <h1 className="text-foreground text-lg font-semibold">Provider Demo</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Walk through admin provider setup and session runtime availability.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="border-border bg-card rounded-xl border p-4">
            <h2 className="text-foreground text-sm font-semibold">Admin Providers</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              {can(organization?.viewerRole, Permission.ProvidersCompanyManage)
                ? "Visible for this viewer."
                : "Hidden for this viewer."}
            </p>
            <Button asChild className="mt-4" size="sm" variant="outline">
              <Link to="/providers">Open providers</Link>
            </Button>
          </section>

          <section className="border-border bg-card rounded-xl border p-4">
            <h2 className="text-foreground text-sm font-semibold">Agent Runtime</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Agent sessions resolve runtime availability before execution.
            </p>
            <Button asChild className="mt-4" size="sm" variant="outline">
              <Link to="/agent">Open agents</Link>
            </Button>
          </section>
        </div>

        <section className="border-border bg-card rounded-xl border p-4">
          <h2 className="text-foreground text-sm font-semibold">Runtime Availability</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {PUBLIC_RUNTIME_CATALOG.map((runtime) => (
              <div
                key={runtime.runtimeId}
                className="bg-muted/50 flex items-center gap-3 rounded-lg px-3 py-2"
              >
                {hasRuntimeIcon(runtime.runtimeId) ? (
                  <RuntimeIcon
                    className="size-6 rounded-md bg-white p-1"
                    runtimeId={runtime.runtimeId}
                  />
                ) : null}
                <div className="min-w-0">
                  <div className="text-foreground text-sm font-medium">{runtime.label}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    {runtime.defaultModel}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
