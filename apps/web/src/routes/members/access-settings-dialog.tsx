import type { OrganizationJoinPolicy } from "@mosoo/contracts/organization";
import { Check, Copy, Loader2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import { isTruthy } from "../../shared/lib/truthiness";
export function AccessSettingsDialog({
  copied,
  joinPolicy,
  canConvertPersonal,
  convertingPersonal,
  conversionBlockedReason,
  isPersonalOrganization,
  onCopyLink,
  onOpenChange,
  onPolicyChange,
  onPrimaryDomainChange,
  onPrimaryDomainSave,
  onRequestConvertPersonal,
  open,
  primaryDomain,
  requestAccessLink,
  savingPrimaryDomain,
}: {
  copied: boolean;
  canConvertPersonal: boolean;
  convertingPersonal: boolean;
  conversionBlockedReason: string | null;
  isPersonalOrganization: boolean;
  joinPolicy: OrganizationJoinPolicy;
  onCopyLink: () => void;
  onOpenChange: (open: boolean) => void;
  onPolicyChange: (policy: OrganizationJoinPolicy) => void;
  onPrimaryDomainChange: (value: string) => void;
  onPrimaryDomainSave: () => void;
  onRequestConvertPersonal: () => void;
  open: boolean;
  primaryDomain: string;
  requestAccessLink: string;
  savingPrimaryDomain: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-lg sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Access Settings</DialogTitle>
          <DialogDescription>
            Control how people discover and join this organization.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {isPersonalOrganization ? (
            <div className="border-border bg-muted/30 rounded-lg border p-3">
              <div className="text-foreground text-[13px] font-semibold">Personal Org</div>
              <p className="text-muted-foreground mt-1 text-[12px] leading-relaxed">
                This sandbox is only for you. Convert it before inviting members, accepting access
                requests, or claiming a company domain.
              </p>
              {canConvertPersonal || Boolean(conversionBlockedReason) ? (
                <Button
                  className="mt-3"
                  size="sm"
                  variant="destructive"
                  onClick={onRequestConvertPersonal}
                  disabled={convertingPersonal || !canConvertPersonal}
                >
                  {convertingPersonal ? <Loader2 className="size-4 animate-spin" /> : "Convert"}
                </Button>
              ) : null}
              {isTruthy(conversionBlockedReason) ? (
                <p className="text-muted-foreground mt-2 text-[11.5px] leading-relaxed">
                  {conversionBlockedReason}
                </p>
              ) : null}
            </div>
          ) : null}

          <div>
            <div className="text-foreground text-[13px] font-semibold">Primary domain</div>
            <p className="text-muted-foreground mt-0.5 text-[12px]">
              {isPersonalOrganization
                ? "Claiming a company domain will convert this Personal Org."
                : "Claim one company email domain for discovery."}
            </p>
            <div className="mt-3 flex gap-2">
              <input
                aria-label="Primary domain"
                type="text"
                value={primaryDomain}
                onChange={(event) => {
                  onPrimaryDomainChange(event.target.value);
                }}
                placeholder="company.com"
                className="border-border bg-background focus:ring-primary/20 focus:border-primary h-9 min-w-0 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
              />
              <Button size="sm" onClick={onPrimaryDomainSave} disabled={savingPrimaryDomain}>
                {savingPrimaryDomain ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : isPersonalOrganization && primaryDomain.trim() ? (
                  "Convert and claim"
                ) : (
                  "Save"
                )}
              </Button>
            </div>
          </div>

          <div className="border-border border-t pt-4">
            <div className="text-foreground text-[13px] font-semibold">Domain discovery</div>
            <p className="text-muted-foreground mt-0.5 text-[12px]">
              {isPersonalOrganization
                ? "Convert this Personal Org before enabling discovery."
                : "Applies to anyone with a matching email domain."}
            </p>
            <div className="mt-3 space-y-2">
              <label
                aria-label="Auto join"
                className="border-border bg-background hover:bg-accent/30 flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5"
              >
                <input
                  aria-label="Auto join"
                  id="access-policy-auto-join"
                  name="organization-join-policy"
                  type="radio"
                  checked={joinPolicy === "auto"}
                  onChange={() => {
                    onPolicyChange("auto");
                  }}
                  disabled={isPersonalOrganization}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="text-foreground block text-[12.5px] font-semibold">
                    Auto join
                  </span>
                  <span className="text-muted-foreground block text-[11.5px]">
                    Matching users join without admin review.
                  </span>
                </span>
              </label>
              <label
                aria-label="Invite only"
                className="border-border bg-background hover:bg-accent/30 flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5"
              >
                <input
                  aria-label="Invite only"
                  id="access-policy-invite-only"
                  name="organization-join-policy"
                  type="radio"
                  checked={joinPolicy === "invite_only"}
                  onChange={() => {
                    onPolicyChange("invite_only");
                  }}
                  disabled={isPersonalOrganization}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="text-foreground block text-[12.5px] font-semibold">
                    Invite only
                  </span>
                  <span className="text-muted-foreground block text-[11.5px]">
                    Admin review required for every request.
                  </span>
                </span>
              </label>
            </div>
          </div>

          {!isPersonalOrganization ? (
            <div className="border-border border-t pt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-foreground text-[13px] font-semibold">
                    Request access link
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-[12px]">
                    Anyone with this link can request access.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={onCopyLink}>
                  {copied ? (
                    <>
                      <Check className="mr-1.5 size-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="mr-1.5 size-3.5" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
              <div className="border-border bg-muted/40 text-muted-foreground mt-2 rounded-lg border px-3 py-2 font-mono text-[11px] break-all">
                {requestAccessLink}
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PersonalOrgConversionDialog({
  busy,
  confirmLabel,
  description,
  onConfirm,
  onOpenChange,
  open,
  title,
}: {
  busy: boolean;
  confirmLabel: string;
  description: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-lg sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
