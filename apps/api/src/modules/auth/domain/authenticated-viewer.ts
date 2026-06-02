import type { AccountId } from "@mosoo/id";

export interface AuthenticatedViewer {
  auditActor?: {
    display: string;
    id: string | null;
    metadata?: Record<string, unknown> | undefined;
    type: "agent" | "api_key" | "system" | "user";
  };
  auditContext?: {
    ipAddress: string | null;
    userAgent: string | null;
  };
  email: string;
  emailVerified: boolean;
  id: AccountId;
  imageUrl: string | null;
  name: string;
}
