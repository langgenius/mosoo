import { MOSOO_CONSOLE_ORIGIN } from "@mosoo/contracts/origin";

import { HELP_DOCS_BASE_URL } from "@/shared/config/help-docs";

export const INSTALL_COMMAND = "curl -fsSL https://install.mosoo.ai/install.sh | bash";

function currentOrigin(): string {
  return globalThis.window !== undefined ? globalThis.location.origin : MOSOO_CONSOLE_ORIGIN;
}

/**
 * Copy-ready onboarding instruction for any coding agent (Codex, Claude Code,
 * OpenCode, Cursor, Cline, and others). It mirrors the console checklist on
 * the Project Overview: install and sign in, provider key, API token, first agent
 * and session. The provider key is the one value an agent cannot mint itself,
 * so the prompt tells the agent to ask the user for it; CLI sign-in creates
 * its own token through the browser login callback.
 */
export function buildOnboardingSetupPrompt(
  origin: string = currentOrigin(),
  t: (key: string, variables?: Record<string, string>) => string = (key) => key,
): string {
  return t("projectOverview.setupPrompt", {
    docsUrl: HELP_DOCS_BASE_URL,
    installCommand: INSTALL_COMMAND,
    origin,
  });
}
