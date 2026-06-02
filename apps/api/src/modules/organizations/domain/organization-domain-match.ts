import { forbiddenError } from "../../../platform/errors";
import { getPublicEmailDomain } from "../../auth/domain/email-domain";
import { normalizeEmail } from "../../users/domain/email-address";

export function getOrganizationEmailDomain(email: string): string {
  const domain = normalizeEmail(email).split("@")[1]?.trim().toLowerCase() ?? "";

  if (!domain) {
    throw forbiddenError("A verified organization email is required.");
  }

  if (getPublicEmailDomain(domain)) {
    throw forbiddenError("Public email domains cannot request organization access.");
  }

  return domain;
}
