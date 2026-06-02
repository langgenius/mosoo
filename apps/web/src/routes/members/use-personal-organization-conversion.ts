import { useState } from "react";

import {
  convertPersonalOrganization,
  updateOrganizationPrimaryDomain,
} from "../../domains/organization/api/organization-client";
import { toOrganizationId } from "../typed-id";

export function usePersonalOrganizationConversion({
  canConvertPersonalOrganization,
  conversionUnavailableMessage,
  loadAccessSurface,
  organizationId,
  primaryDomain,
  refreshOrganizations,
  setError,
  setPrimaryDomain,
}: {
  canConvertPersonalOrganization: boolean;
  conversionUnavailableMessage: string | null;
  loadAccessSurface: () => Promise<void>;
  organizationId: string;
  primaryDomain: string;
  refreshOrganizations: () => Promise<unknown>;
  setError: (error: string | null) => void;
  setPrimaryDomain: (domain: string) => void;
}) {
  const [convertPersonalOpen, setConvertPersonalOpen] = useState(false);
  const [convertAndClaimOpen, setConvertAndClaimOpen] = useState(false);
  const [convertingPersonal, setConvertingPersonal] = useState(false);
  const [savingConvertAndClaim, setSavingConvertAndClaim] = useState(false);
  const typedOrganizationId = toOrganizationId(organizationId);

  async function handleConvertPersonal() {
    if (!canConvertPersonalOrganization) {
      setError(conversionUnavailableMessage ?? "Only the Personal Org owner can convert it.");
      return;
    }

    setConvertingPersonal(true);
    setError(null);

    try {
      const nextOrganization = await convertPersonalOrganization(typedOrganizationId);
      setPrimaryDomain(nextOrganization.primaryDomain ?? "");
      setConvertPersonalOpen(false);
      await refreshOrganizations();
      await loadAccessSurface();
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Unexpected error");
    } finally {
      setConvertingPersonal(false);
    }
  }

  async function handleConvertAndClaimDomain() {
    if (!canConvertPersonalOrganization) {
      setError(conversionUnavailableMessage ?? "Only the Personal Org owner can convert it.");
      return;
    }

    const domain = primaryDomain.trim();

    if (!domain) {
      setConvertAndClaimOpen(false);
      return;
    }

    setSavingConvertAndClaim(true);
    setError(null);

    try {
      const nextOrganization = await updateOrganizationPrimaryDomain(
        typedOrganizationId,
        domain,
        true,
      );
      setPrimaryDomain(nextOrganization.primaryDomain ?? "");
      setConvertAndClaimOpen(false);
      await refreshOrganizations();
      await loadAccessSurface();
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : "Unexpected error");
    } finally {
      setSavingConvertAndClaim(false);
    }
  }

  return {
    convertAndClaimOpen,
    convertPersonalOpen,
    convertingPersonal,
    handleConvertAndClaimDomain,
    handleConvertPersonal,
    savingConvertAndClaim,
    setConvertAndClaimOpen,
    setConvertPersonalOpen,
  };
}
