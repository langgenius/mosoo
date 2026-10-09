# Local E2E Harness

The Playwright specs live in `e2e/cases`. Run them from the repository root with `just e2e`, which passes its arguments to `playwright test`: a path or part of one selects specs (`just e2e e2e/cases/ui/files-page.spec.ts`, `just e2e deterministic`), and `--grep` filters by test title. Without arguments it runs every spec, the live ones included.

`e2e/playwright.config.ts` loads `.env` from the repository root when it exists; values already set in the shell win. An unset or empty `NO_PROXY` or `no_proxy` defaults to the loopback hosts, so a shell proxy never intercepts the local console.

## Fixture-backed specs

`deterministic/session-log.spec.ts` and every `ui` spec except `preview.spec.ts` need no provider keys or Worker bindings: they answer the console's GraphQL and auth-session requests with fixtures. Playwright reuses whatever already answers the base URL, `MOSOO_E2E_BASE_URL` or `http://127.0.0.1:$WEB_DEV_PORT` (port 5173) when it is unset, and otherwise starts only `@mosoo/web`. Screenshot specs write their review images under `.tmp/e2e/`.

## Live specs

`ui/preview.spec.ts` and `public-api/runtime.spec.ts` call real models. Start the local stack with `just dev` first: Playwright on its own starts only the console, without the API. They sign in through the local `@mosoo.ai` development login, so they cannot target a deployed environment.

Choose the provider with `MOSOO_E2E_PROVIDER` and set its key, or the generic `MOSOO_E2E_PROVIDER_API_KEY`, which wins when both are set. Omitting the provider selects `openai`, so a DeepSeek or OpenCode key alone is not enough.

| `MOSOO_E2E_PROVIDER` | Specs                                              | Key                           | Notes                                                                                                    |
| -------------------- | -------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `openai` (default)   | `ui/preview.spec.ts`, `public-api/runtime.spec.ts` | `MOSOO_E2E_OPENAI_API_KEY`    |                                                                                                          |
| `anthropic`          | `ui/preview.spec.ts`, `public-api/runtime.spec.ts` | `MOSOO_E2E_ANTHROPIC_API_KEY` |                                                                                                          |
| `opencode`           | `public-api/runtime.spec.ts`                       | `MOSOO_E2E_OPENCODE_API_KEY`  | OpenCode Zen only                                                                                        |
| `deepseek`           | `public-api/runtime.spec.ts`                       | `MOSOO_E2E_DEEPSEEK_API_KEY`  | Runs on OpenCode (`acp-fallback`); optional `MOSOO_E2E_DEEPSEEK_BASE_URL` and `MOSOO_E2E_DEEPSEEK_MODEL` |
| `pi`                 | `public-api/runtime.spec.ts`                       | `MOSOO_E2E_PI_API_KEY`        | Requires `MOSOO_E2E_PI_MODEL` and `MOSOO_E2E_PI_BASE_URL` for a custom Chat Completions endpoint         |

In `public-api/runtime.spec.ts`, `MOSOO_E2E_RUNTIME_ID` overrides the runtime chosen for the provider; with `pi` it must be `pi` or unset.

`public-api/runtime.spec.ts` creates a provider credential and an Agent, publishes the Agent, creates a Project key, and waits for a text reply through `/api/v1`. It proves text completion only, not tool execution or cold resume. Keep credentials in the environment, never in committed files.
