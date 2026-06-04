import { Loader2, Settings2, Upload, UserPlus, X } from "lucide-react";
import type { ChangeEvent, ComponentProps, KeyboardEvent } from "react";

import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/page-header";

import type { Organization } from "../../domains/organization/api/organization-client";
import { isTruthy } from "../../shared/lib/truthiness";
import { AccessSettingsDialog, PersonalOrgConversionDialog } from "./access-settings-dialog";
import { AttentionPanel } from "./attention-panel";
import { BulkInviteDialog } from "./bulk-invite-dialog";
import { MembersList } from "./members-list";
import { useMembersAccessModel } from "./use-members-access-model";
type MemberRoleChangeHandler = ComponentProps<typeof MembersList>["onRoleChange"];

export function MembersTab({
  currentUserId,
  focusedMemberId,
  organization,
}: {
  currentUserId: string;
  focusedMemberId: string | null;
  organization: Organization;
}) {
  const model = useMembersAccessModel({ currentUserId, focusedMemberId, organization });
  const handleAccessSettingsOpenChange = model.setAccessSettingsOpen;
  const handleBulkDragOverChange = model.setBulkDragOver;
  const handleBulkEmailsChange = model.setBulkEmails;
  const handleBulkInvite = () => {
    void model.handleBulkInvite();
  };
  const handleBulkOpenChange = model.setBulkOpen;
  const handleBulkReset = model.resetBulk;
  const handleCancelInvitation = (invitationId: string) => {
    void model.handleCancelInvitation(invitationId);
  };
  const handleConvertAndClaimDomain = () => {
    void model.handleConvertAndClaimDomain();
  };
  const handleConvertAndClaimOpenChange = model.setConvertAndClaimOpen;
  const handleConvertPersonal = () => {
    void model.handleConvertPersonal();
  };
  const handleConvertPersonalOpenChange = model.setConvertPersonalOpen;
  const handleCopyLink = () => {
    void model.handleCopyLink();
  };
  const handleCsvFile = (file: File) => {
    void model.handleCsvFile(file);
  };
  const handleInvite = () => {
    void model.handleInvite();
  };
  const handleInviteEmailChange = (event: ChangeEvent<HTMLInputElement>) => {
    model.setInviteEmail(event.target.value);
  };
  const handleInviteKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      void model.handleInvite();
    }
  };
  const handleInviteNoticeDismiss = () => {
    model.setInviteNotice(null);
  };
  const handleInvitePanelClose = () => {
    model.setShowInvite(false);
    model.setInviteEmail("");
  };
  const handleMemberRemove = (userId: string) => {
    void model.handleRemove(userId);
  };
  const handleMemberSearchChange = model.setMemberSearch;
  const handleOpenAccessSettings = () => {
    model.setAccessSettingsOpen(true);
  };
  const handleOpenBulkInvite = () => {
    model.resetBulk();
    model.setBulkOpen(true);
  };
  const handleOpenInvite = () => {
    model.setShowInvite(true);
  };
  const handlePrimaryDomainChange = model.setPrimaryDomain;
  const handlePrimaryDomainSave = () => {
    void model.handlePrimaryDomainSave();
  };
  const handleRequestConvertPersonal = () => {
    model.setConvertPersonalOpen(true);
  };
  const handleReviewRequest = (requestId: string, decision: "approve" | "reject") => {
    void model.handleReviewRequest(requestId, decision);
  };
  const handleRoleChange: MemberRoleChangeHandler = (userId, role) => {
    void model.handleRoleChange(userId, role);
  };
  const handleToggleAttention = () => {
    model.setAttentionOpen(!model.attentionOpen);
  };

  return (
    <>
      <PageHeader
        className="border-border-subtle border-b"
        title="Members & Access"
        description={`${model.members.length} ${
          model.members.length === 1 ? "member" : "members"
        } in this organization`}
      >
        {model.canOpenAccessSettings ? (
          <Button variant="outline" size="sm" onClick={handleOpenAccessSettings}>
            <Settings2 className="mr-1.5 size-3.5" />
            Access Settings
          </Button>
        ) : null}
        {model.canDirectInvite ? (
          <Button variant="outline" size="sm" onClick={handleOpenBulkInvite}>
            <Upload className="mr-1.5 size-3.5" />
            Import CSV
          </Button>
        ) : null}
        {model.canInviteMembers ? (
          <Button size="sm" onClick={handleOpenInvite}>
            <UserPlus className="mr-1.5 size-3.5" />
            {model.canDirectInvite ? "Invite" : "Request invite"}
          </Button>
        ) : null}
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-4xl space-y-5">
          {model.canReviewAccess && !model.loading && model.attentionCount > 0 ? (
            <AttentionPanel
              accessRequests={model.accessRequests}
              cancellingInvitationId={model.cancellingInvitationId}
              invitations={model.invitations}
              onCancelInvitation={handleCancelInvitation}
              onReviewRequest={handleReviewRequest}
              onToggle={handleToggleAttention}
              open={model.attentionOpen}
              reviewingRequestId={model.reviewingRequestId}
            />
          ) : null}

          {model.showInvite ? (
            <div className="border-border bg-accent/20 rounded-xl border p-3">
              <div className="flex gap-2">
                <input
                  aria-label="Invite teammate by email"
                  type="email"
                  placeholder="teammate@company.com"
                  value={model.inviteEmail}
                  onChange={handleInviteEmailChange}
                  onKeyDown={handleInviteKeyDown}
                  className="border-border bg-background focus:ring-primary/20 focus:border-primary h-9 flex-1 rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                />
                <Button size="sm" onClick={handleInvite} disabled={model.inviting}>
                  {model.inviting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : model.canDirectInvite ? (
                    "Send invite"
                  ) : (
                    "Submit for review"
                  )}
                </Button>
                <Button size="sm" variant="ghost" onClick={handleInvitePanelClose}>
                  <X className="size-4" />
                </Button>
              </div>
              {!model.canDirectInvite ? (
                <p className="text-muted-foreground mt-2 text-[11.5px]">
                  An organization admin will review and approve this invitation before it is sent.
                </p>
              ) : null}
            </div>
          ) : null}

          {isTruthy(model.inviteNotice) ? (
            <div className="border-green-200/70 bg-success-bg/60 text-success-fg flex items-start justify-between gap-3 rounded-lg border p-3 text-sm">
              <span>{model.inviteNotice}</span>
              <button
                type="button"
                aria-label="Dismiss"
                className="text-success-fg/70 hover:text-success-fg"
                onClick={handleInviteNoticeDismiss}
              >
                <X className="size-4" />
              </button>
            </div>
          ) : null}

          {isTruthy(model.error) ? (
            <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm">
              {model.error}
            </div>
          ) : null}

          {model.loading ? (
            <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
              Loading members…
            </div>
          ) : (
            <MembersList
              currentUserId={currentUserId}
              focusedMemberId={focusedMemberId}
              filteredMembers={model.filteredMembers}
              memberSearch={model.memberSearch}
              members={model.members}
              onMemberSearchChange={handleMemberSearchChange}
              onRemove={handleMemberRemove}
              onRoleChange={handleRoleChange}
              viewerRole={model.viewerRole}
            />
          )}
        </div>
      </div>

      <BulkInviteDialog
        dragOver={model.bulkDragOver}
        emails={model.bulkEmails}
        error={model.bulkError}
        fileName={model.bulkFileName}
        inviting={model.bulkInviting}
        onFile={handleCsvFile}
        onInvite={handleBulkInvite}
        onOpenChange={handleBulkOpenChange}
        onReset={handleBulkReset}
        onSetDragOver={handleBulkDragOverChange}
        onSetEmails={handleBulkEmailsChange}
        open={model.bulkOpen}
        parsing={model.bulkParsing}
        result={model.bulkResult}
      />

      <AccessSettingsDialog
        canConvertPersonal={model.canConvertPersonalOrganization}
        copied={model.copied}
        convertingPersonal={model.convertingPersonal}
        conversionBlockedReason={model.personalConversionBlockedReason}
        isPersonalOrganization={model.isPersonalOrganization}
        joinPolicy={model.joinPolicy}
        onCopyLink={handleCopyLink}
        onOpenChange={handleAccessSettingsOpenChange}
        onPolicyChange={(policy) => void model.handlePolicyChange(policy)}
        onPrimaryDomainChange={handlePrimaryDomainChange}
        onPrimaryDomainSave={handlePrimaryDomainSave}
        onRequestConvertPersonal={handleRequestConvertPersonal}
        open={model.accessSettingsOpen}
        primaryDomain={model.primaryDomain}
        requestAccessLink={model.requestAccessLink}
        savingPrimaryDomain={model.savingPrimaryDomain}
      />

      <PersonalOrgConversionDialog
        busy={model.convertingPersonal}
        confirmLabel="Convert"
        description="This turns your Personal Org into a collaborative organization, uses your CE organization creation slot, and frees your Personal Org slot. You'll be able to create a new Personal Org afterwards. This cannot be undone."
        onConfirm={handleConvertPersonal}
        onOpenChange={handleConvertPersonalOpenChange}
        open={model.convertPersonalOpen}
        title="Convert to Organization?"
      />

      <PersonalOrgConversionDialog
        busy={model.savingConvertAndClaim}
        confirmLabel="Convert and claim"
        description="Claiming a company domain turns this Personal Org into an organization for collaboration. This uses your CE organization creation slot, frees your Personal Org slot, and cannot be undone."
        onConfirm={handleConvertAndClaimDomain}
        onOpenChange={handleConvertAndClaimOpenChange}
        open={model.convertAndClaimOpen}
        title="Convert and claim domain?"
      />
    </>
  );
}
