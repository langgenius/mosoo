import { Check, ChevronDown, Plus, Trash2 } from "lucide-react";
import type { ReactElement } from "react";

import { Badge } from "@/shared/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import type { VendorCredential } from "../../domains/vendor-credential/api/vendor-credential-client";
import type { VisibleVendor } from "./provider-card-types";

function ActiveKey({
  activePersonal,
  companyDefault,
  providerAllowed,
}: {
  activePersonal: VendorCredential | undefined;
  companyDefault: VendorCredential | undefined;
  providerAllowed: boolean;
}): ReactElement {
  if (!providerAllowed) {
    return (
      <span className="inline-flex min-w-0 items-center gap-2">
        <Badge variant="outline">UNAVAILABLE</Badge>
        <span className="truncate">Provider disabled</span>
      </span>
    );
  }

  if (activePersonal !== undefined) {
    return (
      <span className="inline-flex min-w-0 items-center gap-2">
        <Badge variant="success">PERSONAL</Badge>
        <span className="truncate">{activePersonal.name}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <Badge variant="secondary">COMPANY</Badge>
      <span className="truncate">{companyDefault?.name ?? "No key selected"}</span>
    </span>
  );
}

function ProviderStateBadge({
  personalAllowed,
  providerAllowed,
}: {
  personalAllowed: boolean;
  providerAllowed: boolean;
}): ReactElement | null {
  if (!providerAllowed) {
    return <Badge variant="outline">Provider disabled</Badge>;
  }

  return personalAllowed ? null : <Badge variant="outline">BYOK disabled</Badge>;
}

export function ProviderActiveKeyMenu({
  activePersonal,
  companyDefault,
  onDelete,
  onStartAddingPersonalKey,
  onUseCompanyDefault,
  onUsePersonal,
  personalAllowed,
  personalCredentials,
  providerAllowed,
  vendor,
}: {
  activePersonal: VendorCredential | undefined;
  companyDefault: VendorCredential | undefined;
  onDelete: (credential: VendorCredential) => void;
  onStartAddingPersonalKey: (vendorId: string) => void;
  onUseCompanyDefault: (vendorId: string) => void;
  onUsePersonal: (credential: VendorCredential) => void;
  personalAllowed: boolean;
  personalCredentials: VendorCredential[];
  providerAllowed: boolean;
  vendor: VisibleVendor;
}): ReactElement {
  return (
    <div className="border-border border-t pt-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-muted-foreground text-[11px] font-semibold tracking-[0.12em] uppercase">
          Active key for me
        </div>
        <ProviderStateBadge personalAllowed={personalAllowed} providerAllowed={providerAllowed} />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="border-border bg-background hover:bg-muted/40 flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm"
          >
            <span className="min-w-0">
              <ActiveKey
                activePersonal={activePersonal}
                companyDefault={companyDefault}
                providerAllowed={providerAllowed}
              />
            </span>
            <ChevronDown className="text-muted-foreground size-4 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[320px] rounded-lg p-1">
          <DropdownMenuItem
            aria-disabled={!providerAllowed}
            className={
              providerAllowed ? "cursor-pointer rounded-md" : "cursor-default rounded-md opacity-60"
            }
            onSelect={(event) => {
              if (!providerAllowed) {
                event.preventDefault();
                return;
              }

              onUseCompanyDefault(vendor.vendorId);
            }}
          >
            <Check className={activePersonal ? "size-3.5 opacity-0" : "size-3.5"} />
            Company default · {companyDefault?.name ?? "No key selected"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>MY KEYS</DropdownMenuLabel>
          {personalCredentials.length > 0 ? (
            personalCredentials.map((credential) => (
              <DropdownMenuItem
                key={credential.id}
                aria-disabled={credential.disabledByPolicy}
                className={
                  credential.disabledByPolicy
                    ? "cursor-default rounded-md opacity-60"
                    : "cursor-pointer rounded-md"
                }
                onSelect={(event) => {
                  if (credential.disabledByPolicy) {
                    event.preventDefault();
                    return;
                  }

                  onUsePersonal(credential);
                }}
              >
                <Check
                  className={
                    credential.isPreferred ? "size-3.5 shrink-0" : "size-3.5 shrink-0 opacity-0"
                  }
                />
                <span className="min-w-0 flex-1 truncate">{credential.name}</span>
                {credential.disabledByPolicy ? (
                  <Badge variant="outline">Disabled by policy</Badge>
                ) : null}
                <button
                  type="button"
                  className="text-destructive hover:bg-destructive/10 ml-1 rounded-sm p-1"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onDelete(credential);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))
          ) : (
            <div className="text-muted-foreground px-2 py-1.5 text-xs">No personal keys.</div>
          )}
          {personalAllowed ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer rounded-md"
                onSelect={() => {
                  onStartAddingPersonalKey(vendor.vendorId);
                }}
              >
                <Plus className="size-3.5" />
                Add my {vendor.label} key…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
