# 2026-09-07 — OpenCode Provider Configuration Failures

- Status: Resolved with configuration-equivalent production verification
- Severity: SEV-2
- Observed failures: 2026-09-02 through 2026-09-05 UTC
- Recovery verification: 2026-09-07 11:01–11:04 and 2026-09-17 09:20–09:28 UTC
- Affected surface: OpenCode (ACP) published-Agent Runs and Preview
- Public status update: https://mosoo.ai/health
- Tracking issue: [#606](https://github.com/langgenius/mosoo/issues/606)
- Production hotfix: [#608](https://github.com/langgenius/mosoo/pull/608)
- Diagnostic follow-up: [#632](https://github.com/langgenius/mosoo/pull/632)

## Summary And Impact

Some OpenCode Runs failed before returning an assistant result. Production
records from September 1 onward identified four Qwen failures (one UI Run and
three Previews) and two OpenAI-compatible DeepSeek failures (one UI Run and one
Preview). Qwen users saw `Internal error: OpenCode service failure`; the custom
DeepSeek path reported a model-proxy capability rejection. Both surfaced as
`acp.turn_failed`.

These six failures establish affected requests, not a continuous outage or a
count of distinct users. The two failed UI Runs were the latest OpenCode
observations in the public status feed before this investigation. Successful
native DeepSeek Previews did not establish that the custom-provider path worked.

A September 7 hotfix restored the verified Qwen path. Real production Qwen and
native DeepSeek Runs completed tool execution, and OpenCode's public status
returned to operational. On September 17, published-Agent and browser Preview
canaries using the affected custom DeepSeek configuration also completed real
tool execution. The canaries used an isolated operator-owned Project and an
authorized OpenRouter key; the original tenant's credential was not accessed.
Sanitized capability-rejection diagnostics are now deployed. These results
resolve the runtime repair and configuration-verification scope, subject to
the historical-evidence and tenant-access limits described below.

## Timeline

All times are UTC. This is an observation timeline, not a measured continuous
outage window.

- September 2, 12:36 — A Qwen UI Run failed with the generic OpenCode service
  error. Additional matching Preview failures occurred on September 2–3.
- September 4 — The selected-model declaration fix merged in
  [#596](https://github.com/langgenius/mosoo/pull/596), but was not yet deployed.
- September 5, 17:46 — A custom DeepSeek UI Run failed with a proxy capability
  rejection; a Preview also failed that day.
- September 7, 10:25 — Investigation confirmed two consecutive failed public
  OpenCode observations. Their age made the component unknown. The website
  nevertheless displayed an operational aggregate.
- September 7 — Production logs and configuration reproductions identified
  the provider declaration defect and a separate namespaced-model defect.
  [#607](https://github.com/langgenius/mosoo/pull/607) merged to main, and
  [website #102](https://github.com/langgenius/mosoo-website/pull/102) corrected
  the misleading status aggregate.
- September 7, 10:59 — The API and Driver hotfix rollout completed through the
  [production workflow](https://github.com/langgenius/mosoo/actions/runs/34113599941).
- September 7, 11:01–11:02 — Published Qwen and native DeepSeek Agents each
  completed a real bash tool call and returned the expected final output.
  OpenCode status became operational with zero consecutive failures.
- September 7, 11:04 — Qwen Browser Preview also completed a real bash tool
  call and displayed the expected result.
- September 17, 09:17 — Deployed the capability-rejection diagnostics in #632.
- September 17, 09:20 — A fresh published Qwen control Run completed a real
  bash tool call and returned the expected final output after the release.
- September 17, 09:28 — Published and browser Preview canaries using the
  original custom DeepSeek configuration each completed a real bash tool call
  and returned the expected final output. The public feed received the new
  successful published Run.

## Root Cause

For Qwen credentials without a restricted model list, the rendered OpenCode
provider configuration omitted the selected model declaration. OpenCode could
then make the selected provider unavailable. The old configuration reproduced
the exact generic service error in a real OpenCode 1.18.4 ACP subprocess before
an inference request. Explicitly declaring the selected model restored execution.

Separately, model IDs containing a slash were treated as already qualified
OpenCode provider selections. For the selected `openai-compatible` provider,
`deepseek/deepseek-v4-flash` is an upstream model ID. It must remain under that
selected provider rather than selecting a different provider. The hotfix keeps
the full upstream ID aligned between the OpenCode configuration and proxy grant,
without widening model authorization.

Cloudflare logs confirm HTTP 403 on the expected Chat Completions proxy paths
for the custom-provider failures. Historical logs do not retain the request
model body, so the exact failed capability comparison remains unproven. The
configuration defect is fixed and regression-tested; its relationship to that
specific historical 403 remains a supported hypothesis. Successful live
canaries verify current behavior; they cannot reconstruct a historical request
body that was never recorded.

The incident deployment was still the September 1 version. A fix merged to main
was therefore not a production recovery. The website also ignored unknown
runtime components when computing its aggregate, obscuring the lack of fresh
recovery evidence.

## Detection And Response

A user noticed failed observations on the status page. Investigation combined
read-only production D1 records, Cloudflare historical logs, source inspection,
and real OpenCode CLI/ACP reproductions with a deterministic local upstream.
The API health endpoint remained healthy, but did not prove model execution.

The hotfix was released separately from unrelated pending database changes.
Full Linux repository checks, non-production Public API smoke, migration-chain
simulation, Worker dry-runs, and production endpoint verification passed. No
production database migration was applied. API and Driver were rolled out
together, with their previous versions recorded for rollback; rollback was not
needed.

On September 7, three live acceptance scenarios passed: published Qwen, published native
DeepSeek, and Qwen Browser Preview. Each executed a harmless `printf` command
through bash, returned exit code 0, and reached a completed Run with the expected
final text. The custom namespaced model passed real CLI/ACP tool execution
against a deterministic upstream, but this is not live acceptance of the
original tenant's provider.

OpenCode's recovery did not establish recovery of the entire platform. At the
post-deployment check, separate OpenAI Runtime failures kept the aggregate
status degraded, while Claude had no fresh signal.

## September 17 Verification And Diagnostics

The custom-provider canary matched the affected configuration's `pet` kind,
`acp-fallback` runtime, `openai-compatible` provider, and full upstream model
`deepseek/deepseek-v4-flash`. Its credential used the same
`https://openrouter.ai/api/v1` endpoint and model allowlist. Read-only production
comparisons also confirmed matching prompt, built-in tools, provider options,
MCP/Skill bindings, packages, environment variables, setup script, and network
settings. The changed identities were the isolated Project, Agent, sessions,
and operator-supplied credential.

| Production path                 | Synthetic Run                | Completed UTC | Result                                                         |
| ------------------------------- | ---------------------------- | ------------- | -------------------------------------------------------------- |
| Published Qwen control          | `01M2QAK91THSDBTJDQCACQSEKY` | 09:20:03.217  | bash exit 0; `MOSOO_606_DIAGNOSTICS_RELEASE_OK`; completed     |
| Published custom DeepSeek       | `01M2QB1SYD926Z7WGF6G6VY1VB` | 09:28:05.581  | bash exit 0; `MOSOO_606_CUSTOM_DEEPSEEK_UI_OK`; completed      |
| Browser Preview custom DeepSeek | `01M2QB2N1P3J510E9S2T7S6EV4` | 09:28:32.054  | bash exit 0; `MOSOO_606_CUSTOM_DEEPSEEK_PREVIEW_OK`; completed |

Both custom-model Runs have completed model-call records for the expected
provider and model. Tool result events record the actual `printf` output and
exit code; the browser also displayed the Preview tool as DONE and the expected
final text. The public OpenCode component reported `operational`, zero
consecutive failures, no latest error, and a new successful observation at
`2026-09-17T09:28:05.951Z`. Preview remains excluded from public Run statistics.

The current Console account still receives a Project authorization 403 for
the original tenant. This is distinct from the original model-proxy capability 403. No customer key was exported, no ownership or authorization was bypassed,
and no customer conversation was replayed. This acceptance establishes live
recovery of the affected configuration with an authorized test key; it does
not assert that the customer's current credential or conversation was tested.

Proxy capability denials now emit `runtime.llm_proxy.capability_rejected` with
one of nine reasons: method or path outside the capability; invalid JSON,
multipart, or body shape; and missing, ambiguous, invalid, or mismatched model.
The event includes the granted protocol, Project/credential/Driver identifiers,
Driver generation, and the existing request/trace context. It excludes raw
models, paths, query strings, headers, parser errors, and request content.
The public 403 response and exact model authorization remain unchanged.

The release is commit `7af92af8d79a9fb1c6a83bff40126f2694f76321`, API Worker
`cd22d8ba-c516-42c5-87f6-01e8895f0e47`, serving 100% from 09:17:41 UTC. No
database migration or container deployment change was required. The 46 proxy
route tests, API type check, [full Ubuntu repository gate](https://github.com/langgenius/mosoo/actions/runs/35203832396),
and [non-production Public API smoke](https://github.com/langgenius/mosoo/actions/runs/35203889970)
passed. Both Worker dry-runs, migration-chain simulation, production schema and
queue checks, HTTP/GraphQL/redirect checks, and inspection of the deployed
diagnostic code passed. Local macOS checks failed in unchanged Driver
process-tree tests, and ARM64 Linux failed an unchanged nested-cancellation
test; the complete Ubuntu CI gate passed without changing those tests.

The pre-release API Worker `34117295-6b55-44d9-847c-04a73b0d0a95` was retained
as the rollback point. No rollback was needed. Synthetic Run evidence is kept;
the temporary canary provider credential is removed after verification.

## Corrective Actions

- [x] Declare the selected OpenCode model for unrestricted credentials —
      [#596](https://github.com/langgenius/mosoo/pull/596), deployed September 7.
- [x] Preserve custom upstream model namespaces under the selected provider;
      retain capability enforcement and add regression coverage —
      [#607](https://github.com/langgenius/mosoo/pull/607), deployed in #608.
- [x] Treat unknown runtime components as unknown in the website aggregate,
      unless a degraded component takes precedence —
      [website #102](https://github.com/langgenius/mosoo-website/pull/102).
- [x] Verify real production tool execution on published Qwen, native DeepSeek,
      and Qwen Preview — September 7.
- [x] Verify the original custom-provider configuration through published and
      browser Preview production canaries — September 17, using an authorized
      operator key in an isolated Project; tenant-access limits are explicit
      above.
- [x] Add sanitized capability-rejection diagnostics that identify the failed
      comparison without recording credentials or user content — #632,
      deployed and verified September 17.

## Lessons

Provider selection and upstream model names are different identifiers, even
when both contain slashes. Test their relationship against real harness behavior
and keep permission checks strict. Track deployment and successful tool
execution separately from merge status and API health. Stale observations should
remain visibly unknown, and verified recovery should state its exact coverage.
