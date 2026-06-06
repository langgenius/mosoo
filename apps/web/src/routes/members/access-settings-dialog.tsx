import type { OrganizationJoinPolicy } from "@mosoo/contracts/organization";
import { Check, Copy, Loader2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

export function AccessSettingsDialog({
  copied,
  joinPolicy,
  onCopyLink,
  onOpenChange,
  onPolicyChange,
  onPrimaryDomainChange,
  onPrimaryDomainSave,
  open,
  primaryDomain,
  requestAccessLink,
  savingPrimaryDomain,
}: {
  copied: boolean;
  joinPolicy: OrganizationJoinPolicy;
  onCopyLink: () => void;
  onOpenChange: (open: boolean) => void;
  onPolicyChange: (policy: OrganizationJoinPolicy) => void;
  onPrimaryDomainChange: (value: string) => void;
  onPrimaryDomainSave: () => void;
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
          <div>
            <div className="text-foreground text-[13px] font-semibold">Primary domain</div>
            <p className="text-muted-foreground mt-0.5 text-[12px]">
              Claim one company email domain for discovery.
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
                {savingPrimaryDomain ? <Loader2 className="size-4 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>

          <div className="border-border border-t pt-4">
            <div className="text-foreground text-[13px] font-semibold">Domain discovery</div>
            <p className="text-muted-foreground mt-0.5 text-[12px]">
              Applies to anyone with a matching email domain.
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

          <div className="border-border border-t pt-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-foreground text-[13px] font-semibold">Request access link</div>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
