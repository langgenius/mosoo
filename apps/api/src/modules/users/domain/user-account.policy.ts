import { getPublicEmailDomain } from "../../auth/domain/email-domain";

export function deriveOrgName(email: string, userName: string): string {
  const domain = email.split("@")[1] ?? "";

  if (!domain || getPublicEmailDomain(domain)) {
    return `${userName}'s Organization`;
  }

  const prefix = domain.split(".")[0] ?? domain;
  return prefix.slice(0, 1).toUpperCase() + prefix.slice(1);
}
