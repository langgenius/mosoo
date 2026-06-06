import { ArrowRight, Building2 } from "lucide-react";

import { isTruthy } from "../../shared/lib/truthiness";
import { getOnboardingDomainOrganizationName } from "./onboarding-domain";

export function OnboardingChoiceScreen({
  bootstrapping,
  domain,
  error,
  onCreate,
}: {
  bootstrapping: boolean;
  domain: string | undefined;
  error: string | null;
  onCreate: (name: string) => void;
}) {
  const domainOrganizationName = getOnboardingDomainOrganizationName(domain);

  return (
    <div className="bg-background fixed inset-0 flex flex-col">
      <div className="flex items-center px-10 py-[22px]">
        <img src="/brand/logo-wordmark-onlight.svg" alt="Mosoo" className="block h-[22px]" />
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-[520px] px-6">
          <div className="mb-6 flex justify-center">
            <div className="border-border bg-ink-100 flex size-16 items-center justify-center rounded-md border">
              <Building2 className="text-accent-press size-7" />
            </div>
          </div>

          <h2 className="text-fg-1 text-center text-[24px] font-semibold tracking-normal">
            Set up your space
          </h2>
          <p className="text-muted-foreground mt-2 text-center text-sm">
            Create your organization to start using Mosoo.
          </p>

          <div className="mt-8 space-y-3">
            <button
              type="button"
              onClick={() => {
                onCreate(domainOrganizationName);
              }}
              disabled={bootstrapping}
              className="group border-primary/30 bg-primary/[0.04] hover:border-primary/50 hover:bg-primary/[0.07] flex w-full items-center justify-between rounded-lg border p-4 text-left transition-all"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="bg-primary/10 flex size-10 shrink-0 items-center justify-center rounded-lg">
                  <Building2 className="text-primary size-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-foreground truncate text-sm font-semibold">
                    Create {domainOrganizationName} organization
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    {isTruthy(domain)
                      ? `For collaboration with people on @${domain}`
                      : "For collaboration with your team"}
                  </div>
                </div>
              </div>
              <ArrowRight className="text-primary size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </div>

          {isTruthy(error) ? (
            <p className="text-destructive mt-4 text-center text-sm">{error}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
