import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { apiPath } from "@/platform/http/public-api";

import {
  isMosooAiDevelopmentBackdoorEnabled,
  mosooAiDevelopmentBackdoorClientPlugin,
} from "../mosoo-ai-development-backdoor";

export const authClient = createAuthClient({
  basePath: apiPath("/auth"),
  plugins: [
    emailOTPClient(),
    ...(isMosooAiDevelopmentBackdoorEnabled() ? [mosooAiDevelopmentBackdoorClientPlugin()] : []),
  ],
});
