import type { CliOAuthDeviceConfirmResponse } from "@mosoo/contracts/auth";

import { requestJson } from "@/platform/http/file-request";

export async function confirmCliOAuthDeviceFlow(
  userCode: string,
): Promise<CliOAuthDeviceConfirmResponse> {
  return requestJson("/auth/cli/confirm", {
    bodyJson: { user_code: userCode },
    method: "POST",
  });
}
