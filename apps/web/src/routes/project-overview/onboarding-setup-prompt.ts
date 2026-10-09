import { MOSOO_DOCS_BASE_URL } from "@/shared/config/external-links";

export const INSTALL_COMMAND = "curl -fsSL https://install.mosoo.ai/install.sh | bash";

/**
 * Copy-ready onboarding instruction for any coding agent (Codex, Claude Code,
 * OpenCode, Cursor, Cline, and others). It mirrors the console checklist on
 * the Project Overview: install and sign in, provider key, API token, first agent
 * and session. The provider key is the one value an agent cannot mint itself,
 * so the prompt tells the agent to ask the user for it; CLI sign-in creates
 * its own token through the browser login callback.
 */
export function buildOnboardingSetupPrompt(
  t: (key: string, variables?: Record<string, string>) => string,
): string {
  return t("projectOverview.setupPrompt", {
    docsUrl: MOSOO_DOCS_BASE_URL,
    installCommand: INSTALL_COMMAND,
    origin: globalThis.location.origin,
  });
}
