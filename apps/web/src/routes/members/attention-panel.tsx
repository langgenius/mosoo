import type {
  OrganizationAccessRequest,
  OrganizationInvitation,
} from "@mosoo/contracts/organization";
import { Bell, ChevronRight, Clock3, Loader2, Mail, Shield } from "lucide-react";

import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui/button";

import { isTruthy } from "../../shared/lib/truthiness";
export function AttentionPanel({
  accessRequests,
  cancellingInvitationId,
  invitations,
  onCancelInvitation,
  onReviewRequest,
  onToggle,
  open,
  reviewingRequestId,
}: {
  accessRequests: OrganizationAccessRequest[];
  cancellingInvitationId: string | null;
  invitations: OrganizationInvitation[];
  onCancelInvitation: (invitationId: string) => void;
  onReviewRequest: (requestId: string, decision: "approve" | "reject") => void;
  onToggle: () => void;
  open: boolean;
  reviewingRequestId: string | null;
}) {
  return (
    <section className="border-amber/25 bg-amber-bg/60 overflow-hidden rounded-xl border">
      <button
        type="button"
        onClick={onToggle}
        className="hover:bg-amber-bg/80 flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Bell className="text-amber-fg size-4" />
          <span className="text-amber-fg text-[13px] font-semibold">
            {accessRequests.length > 0
              ? `${accessRequests.length} access ${accessRequests.length === 1 ? "request" : "requests"}`
              : null}
            {accessRequests.length > 0 && invitations.length > 0 ? " · " : null}
            {invitations.length > 0
              ? `${invitations.length} pending ${invitations.length === 1 ? "invite" : "invites"}`
              : null}
          </span>
        </div>
        <ChevronRight
          className={cn("text-amber-fg size-4 transition-transform", open ? "rotate-90" : "")}
        />
      </button>
      {open ? (
        <div className="bg-background/50 border-amber/25 border-t">
          {accessRequests.map((request) => (
            <div
              key={request.id}
              className="border-border/60 flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Shield className="text-muted-foreground size-3.5" />
                  <span className="text-foreground truncate text-[13px] font-medium">
                    {request.requesterName}
                  </span>
                  <span className="text-muted-foreground text-[11px]">
                    {isTruthy(request.referrerAccountId) ? "invited by member" : "wants to join"}
                  </span>
                  {isTruthy(request.referrerName) ? (
                    <span className="bg-amber-bg text-amber-fg rounded-full px-1.5 py-0.5 text-[10.5px] font-medium">
                      Referred by {request.referrerName}
                    </span>
                  ) : null}
                </div>
                <div className="text-muted-foreground mt-0.5 text-[11.5px]">
                  {request.requesterEmail}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onReviewRequest(request.id, "reject");
                  }}
                  disabled={reviewingRequestId === request.id}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    onReviewRequest(request.id, "approve");
                  }}
                  disabled={reviewingRequestId === request.id}
                >
                  {reviewingRequestId === request.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Approve"
                  )}
                </Button>
              </div>
            </div>
          ))}
          {invitations.map((invitation) => (
            <div
              key={invitation.id}
              className="border-border/60 flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Mail className="text-muted-foreground size-3.5" />
                  <span className="text-foreground truncate text-[13px] font-medium">
                    {invitation.email}
                  </span>
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-[11px]">
                    <Clock3 className="size-3" /> Pending
                  </span>
                </div>
                <div className="text-muted-foreground mt-0.5 text-[11.5px]">
                  Invited by {invitation.invitedByName ?? "an organization admin"}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onCancelInvitation(invitation.id);
                }}
                disabled={cancellingInvitationId === invitation.id}
                className="text-muted-foreground hover:text-destructive"
              >
                {cancellingInvitationId === invitation.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Cancel"
                )}
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
