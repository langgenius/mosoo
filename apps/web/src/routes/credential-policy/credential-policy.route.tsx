import { Permission, can } from "@mosoo/contracts/permission";
import { ignorePromiseRejection } from "@mosoo/effects";
import { PUBLIC_VENDORS } from "@mosoo/runtime-catalog";
import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

import { Badge } from "@/shared/ui/badge";
import { VendorIcon, hasVendorIcon } from "@/shared/ui/brand-icons";
import { PageHeader } from "@/shared/ui/page-header";
import { Switch } from "@/shared/ui/switch";

import { useAppSession } from "../../app/session-provider";
import {
  listVendorCredentials,
  updateCredentialPolicy,
} from "../../domains/vendor-credential/api/vendor-credential-client";
import type { CredentialPolicy } from "../../domains/vendor-credential/api/vendor-credential-client";
import { isTruthy } from "../../shared/lib/truthiness";
export function CredentialPolicyPage() {
  const { activeOrganization: organization, organizationsLoading } = useAppSession();
  const [policy, setPolicy] = useState<CredentialPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customProviderAllowed, setCustomProviderAllowed] = useState(true);
  const isAdmin = can(organization?.viewerRole, Permission.ProvidersCompanyManage);
  const organizationId = organization?.id ?? null;

  useEffect(() => {
    if (!isTruthy(organizationId) || !isAdmin) {
      setLoading(organizationsLoading);
      return;
    }

    const abortController = new AbortController();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = await listVendorCredentials(organizationId, true);
        if (!abortController.signal.aborted) {
          setPolicy(result.policy);
        }
      } catch (nextError) {
        if (!abortController.signal.aborted) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load policy.");
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [isAdmin, organizationId, organizationsLoading]);

  if (!organization) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
        {organizationsLoading ? "Loading organization…" : "No organization available."}
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/providers" replace />;
  }

  async function handlePolicyChange(nextPolicy: CredentialPolicy) {
    setPolicy(nextPolicy);
    setSaving(true);
    setError(null);

    try {
      const updated = await updateCredentialPolicy(nextPolicy);
      setPolicy(updated);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to update policy.");
      try {
        const result = await listVendorCredentials(nextPolicy.organizationId, true);
        setPolicy(result.policy);
      } catch (reloadError) {
        ignorePromiseRejection(reloadError);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader
        className="border-border-subtle border-b"
        title="Credential Policy"
        description="Decide whether members can attach their own LLM keys and which providers they can see and use."
      />

      <main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto w-full max-w-4xl space-y-6">
          {loading ? (
            <div className="border-border bg-card text-muted-foreground rounded-lg border px-4 py-6 text-sm">
              Loading credential policy…
            </div>
          ) : null}

          {isTruthy(error) ? (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm">
              {error}
            </div>
          ) : null}

          {!loading && policy ? (
            <>
              <section className="space-y-3">
                <div className="flex items-center gap-3">
                  <Badge variant="success">A</Badge>
                  <div>
                    <h2 className="text-foreground text-sm font-semibold">BYOK master switch</h2>
                    <p className="text-muted-foreground text-xs">
                      Members can add and manage their own API keys.
                    </p>
                  </div>
                </div>

                <label
                  className="border-border-strong bg-card flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
                  htmlFor="credential-policy-byok-enabled"
                >
                  <div>
                    <div className="text-foreground text-sm font-semibold">
                      Allow members to add their own credentials
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-xs">
                      When off, company credentials can still be used for allowed providers.
                    </div>
                  </div>
                  <Switch
                    checked={policy.byokEnabled}
                    disabled={saving}
                    id="credential-policy-byok-enabled"
                    onCheckedChange={(checked) =>
                      void handlePolicyChange({ ...policy, byokEnabled: checked })
                    }
                  />
                </label>
              </section>

              <section className="space-y-3">
                <div className="flex items-center gap-3">
                  <Badge variant="success">B</Badge>
                  <div>
                    <h2 className="text-foreground text-sm font-semibold">Allowed providers</h2>
                    <p className="text-muted-foreground text-xs">
                      Providers members can see and use in this organization.
                    </p>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {PUBLIC_VENDORS.map((vendor) => {
                    const checked = policy.allowedProviderIds.includes(vendor.vendorId);

                    return (
                      <label
                        htmlFor={`credential-policy-provider-${vendor.vendorId}`}
                        key={vendor.vendorId}
                        className={
                          checked
                            ? "border-primary/40 bg-primary/5 flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                            : "border-border-strong bg-card flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                        }
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {hasVendorIcon(vendor.vendorId) ? (
                            <VendorIcon
                              className="size-7 shrink-0 rounded-md bg-white p-1"
                              vendorId={vendor.vendorId}
                            />
                          ) : (
                            <span className="bg-secondary text-secondary-foreground flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold">
                              {vendor.label.charAt(0)}
                            </span>
                          )}
                          <span className="text-foreground truncate text-sm font-semibold">
                            {vendor.label}
                          </span>
                        </span>
                        <Switch
                          checked={checked}
                          disabled={saving}
                          id={`credential-policy-provider-${vendor.vendorId}`}
                          onCheckedChange={(nextChecked) => {
                            const nextProviderIds = nextChecked
                              ? [...policy.allowedProviderIds, vendor.vendorId]
                              : policy.allowedProviderIds.filter((id) => id !== vendor.vendorId);

                            void handlePolicyChange({
                              ...policy,
                              allowedProviderIds: nextProviderIds,
                            });
                          }}
                        />
                      </label>
                    );
                  })}
                  <label
                    htmlFor="credential-policy-provider-openai-compatible"
                    className={
                      customProviderAllowed
                        ? "border-primary/40 bg-primary/5 flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                        : "border-border-strong bg-card flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                    }
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="border-border-strong bg-card text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-md border border-dashed text-[11px] font-semibold">
                        OAI
                      </span>
                      <span className="text-foreground truncate text-sm font-semibold">
                        OpenAI-Compatible
                      </span>
                    </span>
                    <Switch
                      checked={customProviderAllowed}
                      disabled={saving}
                      id="credential-policy-provider-openai-compatible"
                      onCheckedChange={setCustomProviderAllowed}
                    />
                  </label>
                </div>
              </section>

              <div className="border-border bg-card text-muted-foreground flex gap-3 rounded-lg border px-4 py-3 text-sm">
                <Info className="mt-0.5 size-4 shrink-0" />
                <p>
                  Disabled providers are hidden from members and cannot be used at runtime. Existing
                  company and personal keys stay stored so admins can re-enable the provider later.
                </p>
              </div>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
