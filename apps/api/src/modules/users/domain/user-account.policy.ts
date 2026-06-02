import { accountsTable } from "@mosoo/db";
import { eq } from "drizzle-orm";

import { getAppDatabase } from "../../../platform/db/drizzle";
import { getPublicEmailDomain } from "../../auth/domain/email-domain";
import { normalizeEmail } from "./email-address";

export function deriveOrgName(email: string, userName: string): string {
  const domain = email.split("@")[1] ?? "";

  if (!domain || getPublicEmailDomain(domain)) {
    return `${userName}'s Organization`;
  }

  const prefix = domain.split(".")[0] ?? domain;
  return prefix.slice(0, 1).toUpperCase() + prefix.slice(1);
}

export async function getAccountByEmail(
  database: D1Database,
  email: string,
): Promise<{ email: string; id: string; imageUrl: string | null; name: string } | null> {
  const normalizedEmail = normalizeEmail(email);
  const existingUser =
    (await getAppDatabase(database)
      .select({
        email: accountsTable.email,
        id: accountsTable.id,
        image_url: accountsTable.image,
        name: accountsTable.name,
      })
      .from(accountsTable)
      .where(eq(accountsTable.email, normalizedEmail))
      .limit(1)
      .get()) ?? null;

  if (!existingUser) {
    return null;
  }

  return {
    email: existingUser.email,
    id: existingUser.id,
    imageUrl: existingUser.image_url,
    name: existingUser.name,
  };
}
