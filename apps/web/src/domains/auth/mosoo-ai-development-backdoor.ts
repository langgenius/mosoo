import { canUseMosooAiDevelopmentBackdoor } from "@mosoo/development-auth";

import { requestJson } from "@/platform/http/file-request";

export function shouldUseMosooAiDevelopmentBackdoor(email: string): boolean {
  return canUseMosooAiDevelopmentBackdoor(email, globalThis.window.location.origin);
}

export async function signInWithMosooAiDevelopmentBackdoor(email: string): Promise<void> {
  await requestJson("/auth/development-backdoor/mosoo-ai-login", {
    bodyJson: { email: email.trim() },
    method: "POST",
  });
}
