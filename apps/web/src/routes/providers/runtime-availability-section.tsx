import { PUBLIC_RUNTIME_CATALOG, listPlannedRuntimeDisplayEntries } from "@mosoo/runtime-catalog";
import type { ReactElement } from "react";

import type { VendorCredential } from "@/domains/vendor-credential/api/vendor-credential-client";
import { cn } from "@/shared/lib/class-names";
import { RuntimeIcon, hasRuntimeIcon } from "@/shared/ui/brand-icons";

const COMING_SOON_RUNTIMES = listPlannedRuntimeDisplayEntries("provider-settings");

function RuntimeRow({
  label,
  provider,
  runtimeId,
  status,
  tone,
}: {
  label: string;
  provider: string;
  runtimeId: string;
  status: string;
  tone: "muted" | "ready";
}): ReactElement {
  return (
    <div
      className={cn(
        "bg-muted/40 flex items-center justify-between gap-3 rounded-lg px-3 py-2",
        tone === "muted" ? "opacity-70" : null,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {hasRuntimeIcon(runtimeId) ? (
          <RuntimeIcon className="size-7 shrink-0 rounded-md bg-white p-1" runtimeId={runtimeId} />
        ) : null}
        <div className="min-w-0">
          <div className="text-foreground truncate text-sm font-medium">{label}</div>
          <div className="text-muted-foreground truncate text-xs">{provider}</div>
        </div>
      </div>
      <span
        className={
          tone === "ready"
            ? "text-success-fg shrink-0 text-xs font-medium"
            : "text-muted-foreground shrink-0 text-xs"
        }
      >
        {status}
      </span>
    </div>
  );
}

// Shows which agent runtimes can launch given the keys configured in this App.
// A runtime is ready when the active App has a key for the vendor it resolves.
export function RuntimeAvailabilitySection({
  credentials,
}: {
  credentials: readonly VendorCredential[];
}): ReactElement {
  const configuredVendorIds = new Set(credentials.map((credential) => credential.vendorId));

  return (
    <section className="border-border bg-card rounded-lg border p-4">
      <div className="mb-3">
        <h2 className="text-foreground text-sm font-semibold">Runtime availability</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Runtimes are agent drivers. Each runtime resolves one Provider key in this App before
          launch.
        </p>
      </div>
      <div className="space-y-2">
        {PUBLIC_RUNTIME_CATALOG.map((runtime) => {
          const [vendor] = runtime.vendors;
          const ready = vendor !== undefined && configuredVendorIds.has(vendor.vendorId);
          const provider = vendor?.label ?? runtime.defaultProvider;
          const status =
            runtime.disabledReason ??
            (ready ? "Ready" : `Add a ${vendor?.label ?? "provider"} key`);

          return (
            <RuntimeRow
              key={runtime.runtimeId}
              label={runtime.label}
              provider={provider}
              runtimeId={runtime.runtimeId}
              status={status}
              tone={ready && runtime.disabledReason === undefined ? "ready" : "muted"}
            />
          );
        })}
        {COMING_SOON_RUNTIMES.map((runtime) => (
          <RuntimeRow
            key={runtime.runtimeId}
            label={runtime.label}
            provider={runtime.providerLabel}
            runtimeId={runtime.runtimeId}
            status="Coming soon"
            tone="muted"
          />
        ))}
      </div>
    </section>
  );
}
