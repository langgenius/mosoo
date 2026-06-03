import type { AccountId } from "@mosoo/id";

export interface AuthenticatedViewer {
  email: string;
  emailVerified: boolean;
  id: AccountId;
  imageUrl: string | null;
  name: string;
}
