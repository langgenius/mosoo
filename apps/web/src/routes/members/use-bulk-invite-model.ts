import type { OrganizationInvitation } from "@mosoo/contracts/organization";
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { inviteMember } from "../../domains/organization/api/organization-client";
import { toOrganizationId } from "../typed-id";

const BULK_INVITE_LIMIT = 200;

export interface BulkInviteResult {
  failed: string[];
  success: number;
}

export function useBulkInviteModel({
  canInviteMembers,
  organizationId,
  setInvitations,
}: {
  canInviteMembers: boolean;
  organizationId: string;
  setInvitations: Dispatch<SetStateAction<OrganizationInvitation[]>>;
}) {
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkEmails, setBulkEmails] = useState<string[]>([]);
  const [bulkParsing, setBulkParsing] = useState(false);
  const [bulkInviting, setBulkInviting] = useState(false);
  const [bulkFileName, setBulkFileName] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkInviteResult | null>(null);
  const [bulkDragOver, setBulkDragOver] = useState(false);

  function resetBulk() {
    setBulkEmails([]);
    setBulkFileName(null);
    setBulkError(null);
    setBulkResult(null);
    setBulkParsing(false);
    setBulkInviting(false);
  }

  async function handleCsvFile(file: File) {
    setBulkParsing(true);
    setBulkError(null);
    setBulkFileName(file.name);

    try {
      const text = await file.text();
      const matches = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
      const unique = [...new Set(matches.map((email) => email.toLowerCase()))];
      if (unique.length === 0) {
        setBulkError("No email addresses detected in this file.");
        setBulkEmails([]);
      } else if (unique.length > BULK_INVITE_LIMIT) {
        setBulkError(
          `Import up to ${BULK_INVITE_LIMIT} emails at a time. Split larger lists into multiple files.`,
        );
        setBulkEmails([]);
      } else {
        setBulkEmails(unique);
      }
    } catch (nextError: unknown) {
      setBulkError(nextError instanceof Error ? nextError.message : "Unexpected error");
    } finally {
      setBulkParsing(false);
    }
  }

  async function handleBulkInvite() {
    if (bulkEmails.length === 0) {
      return;
    }

    if (!canInviteMembers) {
      setBulkError("You do not have permission to perform this action.");
      return;
    }

    setBulkInviting(true);
    setBulkError(null);

    const results = await Promise.all(
      bulkEmails.map(async (email) => {
        try {
          const invitation = await inviteMember(toOrganizationId(organizationId), email);
          setInvitations((previous) => [
            invitation,
            ...previous.filter((item) => item.id !== invitation.id),
          ]);
          return { email, ok: true as const };
        } catch {
          return { email, ok: false as const };
        }
      }),
    );

    const failed = results.flatMap((entry) => (entry.ok ? [] : [entry.email]));
    const success = results.length - failed.length;

    setBulkInviting(false);
    setBulkResult({ failed, success });
    if (failed.length === 0) {
      globalThis.setTimeout(() => {
        setBulkOpen(false);
        resetBulk();
      }, 1400);
    }
  }

  return {
    bulkDragOver,
    bulkEmails,
    bulkError,
    bulkFileName,
    bulkInviting,
    bulkOpen,
    bulkParsing,
    bulkResult,
    handleBulkInvite,
    handleCsvFile,
    resetBulk,
    setBulkDragOver,
    setBulkEmails,
    setBulkOpen,
  };
}
