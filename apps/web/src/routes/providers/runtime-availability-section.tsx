import type { PUBLIC_RUNTIME_CATALOG } from "@mosoo/runtime-catalog";
import type { ReactElement } from "react";

import { RuntimeIcon, hasRuntimeIcon } from "@/shared/ui/brand-icons";

import type { VendorCredential } from "../../domains/vendor-credential/api/vendor-credential-client";
import { COMING_SOON_RUNTIMES } from "./coming-soon-runtimes";

type VisibleRuntime = (typeof PUBLIC_RUNTIME_CATALOG)[number];

function runtimeDisabledReason({
  available,
  runtimeReason,
}: {
  available: boolean;
  runtimeReason: string | undefined;
}): string | null {
  if (typeof runtimeReason === "string" && runtimeReason.length > 0) {
    return runtimeReason;
  }

  if (available) {
    return null;
  }

  return "No credential available for this provider";
}

function credentialSuffix({
  activePersonal,
  defaultCredential,
}: {
  activePersonal: VendorCredential | null;
  defaultCredential: VendorCredential | null;
}): string {
  if (activePersonal !== null) {
    return ` · Personal: ${activePersonal.name}`;
  }

  if (defaultCredential !== null) {
    return ` · ${defaultCredential.name}`;
  }

  return "";
}

export function RuntimeAvailabilitySection({
  activePersonalByVendor,
  credentials,
  defaultCredentialByVendor,
  visibleRuntimes,
}: {
  activePersonalByVendor: Map<string, VendorCredential>;
  credentials: VendorCredential[];
  defaultCredentialByVendor: Map<string, VendorCredential>;
  visibleRuntimes: readonly VisibleRuntime[];
}): ReactElement {
  return (
    <section className="border-border bg-card rounded-lg border p-4">
      <div className="mb-3">
        <h2 className="text-foreground text-sm font-semibold">Runtime availability</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Runtimes are agent drivers. Each runtime resolves one Provider credential before launch.
        </p>
      </div>
      <div className="space-y-2">
        {visibleRuntimes.map((runtime) => {
          const [vendor] = runtime.vendors;
          const defaultCredential = vendor ? defaultCredentialByVendor.get(vendor.vendorId) : null;
          const activePersonal = vendor ? activePersonalByVendor.get(vendor.vendorId) : null;
          const companyAvailable = vendor
            ? credentials.some(
                (credential) =>
                  credential.vendorId === vendor.vendorId && credential.scope === "company",
              )
            : false;
          const available = Boolean(companyAvailable || activePersonal);
          const disabledReason = runtimeDisabledReason({
            available,
            runtimeReason: runtime.disabledReason,
          });
          const providerCredentialSuffix = credentialSuffix({
            activePersonal: activePersonal ?? null,
            defaultCredential: defaultCredential ?? null,
          });

          return (
            <div
              key={runtime.runtimeId}
              className="bg-muted/40 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-3">
                {hasRuntimeIcon(runtime.runtimeId) ? (
                  <RuntimeIcon
                    className="size-7 shrink-0 rounded-md bg-white p-1"
                    runtimeId={runtime.runtimeId}
                  />
                ) : null}
                <div className="min-w-0">
                  <div className="text-foreground truncate text-sm font-medium">
                    {runtime.label}
                  </div>
                  <div className="text-muted-foreground truncate text-xs">
                    {vendor?.label ?? runtime.defaultProvider}
                    {providerCredentialSuffix}
                  </div>
                </div>
              </div>
              <span
                className={
                  disabledReason === null
                    ? "shrink-0 text-xs font-medium text-emerald-700"
                    : "text-muted-foreground shrink-0 text-xs"
                }
              >
                {disabledReason ?? "Available"}
              </span>
            </div>
          );
        })}
        {visibleRuntimes.length === 0 ? (
          <div className="bg-muted/40 text-muted-foreground rounded-lg p-3 text-sm">
            No providers are available to you yet.
          </div>
        ) : null}
        {COMING_SOON_RUNTIMES.map((runtime) => (
          <div
            key={runtime.runtimeId}
            className="bg-muted/40 flex items-center justify-between gap-3 rounded-lg px-3 py-2 opacity-70"
          >
            <div className="flex min-w-0 items-center gap-3">
              {hasRuntimeIcon(runtime.runtimeId) ? (
                <RuntimeIcon
                  className="size-7 shrink-0 rounded-md bg-white p-1"
                  runtimeId={runtime.runtimeId}
                />
              ) : null}
              <div className="min-w-0">
                <div className="text-foreground truncate text-sm font-medium">{runtime.label}</div>
                <div className="text-muted-foreground truncate text-xs">{runtime.provider}</div>
              </div>
            </div>
            <span className="text-muted-foreground shrink-0 text-xs">Coming soon</span>
          </div>
        ))}
      </div>
    </section>
  );
}
