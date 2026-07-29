import { MOSOO_CONSOLE_ORIGIN } from "@mosoo/contracts/origin";

import { HELP_DOCS_BASE_URL } from "@/shared/config/help-docs";

export const INSTALL_COMMAND = "curl -fsSL https://install.mosoo.ai/install.sh | bash";

function currentOrigin(): string {
  return globalThis.window !== undefined ? globalThis.location.origin : MOSOO_CONSOLE_ORIGIN;
}

/**
 * Copy-ready onboarding instruction for any coding agent (Codex, Claude Code,
 * OpenCode, Cursor, Cline, and others). It mirrors the console checklist on
 * the App Overview: install and sign in, provider key, API token, first agent
 * and session. The provider key is the one value an agent cannot mint itself,
 * so the prompt tells the agent to ask the user for it; CLI sign-in creates
 * its own token through the browser login callback.
 */
export function buildOnboardingSetupPrompt(origin: string = currentOrigin()): string {
  return `# Set up mosoo

Use this instruction with any coding agent. You are helping the user finish
onboarding to mosoo, an open-source agent runtime: configure an Agent, publish
it, and call it through the Thread API. Work through the steps in order and
skip any step that is already done. Ask the user for values only they know.
Never print or commit secrets.

## Generated variables

\`\`\`text
MOSOO_CONSOLE_URL=${origin}
MOSOO_DOCS_URL=${HELP_DOCS_BASE_URL}
\`\`\`

## 1. Install the mosoo CLI and sign in

\`\`\`bash
${INSTALL_COMMAND}
\`\`\`

The installer adds the mosoo CLI and the @mosoo skill, then opens a browser
sign-in and checks cloud readiness (doctor). The login callback authorizes the
CLI and creates a personal API token for it automatically. If no browser can
open, show the user the sign-in URL printed in the terminal and wait for them
to finish it.

## 2. Add a provider key (required before runs)

Session runs need a model provider credential, for example OpenAI or
Anthropic. This is the one step you cannot complete alone: ask the user which
provider they want and have them add the key at MOSOO_CONSOLE_URL/providers.
Do not start the first run until a provider key is configured.

## 3. Create an API token (optional)

The CLI sign-in from step 1 already covers CLI usage. If this project calls
the Thread API from a backend or script, create a token at
MOSOO_CONSOLE_URL/settings/access-tokens and store it in the project
environment as MOSOO_API_TOKEN. Keep it out of source control.

## 4. Create an agent and run a session

Create an agent at MOSOO_CONSOLE_URL/agent?create=1, then start a first
session from the agent page or MOSOO_CONSOLE_URL/threads?compose=1. The API
flow (create a thread, stream events, continue runs) is documented at
MOSOO_DOCS_URL/coding-agents and MOSOO_DOCS_URL/api-reference.

## 5. Deploy an App (optional)

The App Overview at MOSOO_CONSOLE_URL/ can deploy an App from a public GitHub
repo and bind published agents to it.

## Done when

- The CLI is signed in and doctor reports the cloud is reachable.
- A provider key is configured for the active App.
- An agent exists and at least one Thread run has started under
  MOSOO_CONSOLE_URL/threads.
`;
}
