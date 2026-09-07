# 2026-09-07 — OpenCode Provider Configuration Failures

- Status: Mitigated; monitoring and original-tenant verification pending
- Severity: SEV-2
- Observed failures: 2026-09-02 through 2026-09-05 UTC
- Recovery verification: 2026-09-07 11:01–11:04 UTC
- Affected surface: OpenCode (ACP) published-Agent Runs and Preview
- Public status update: https://mosoo.ai/en/status
- Tracking issue: [#606](https://github.com/langgenius/mosoo/issues/606)
- Production hotfix: [#608](https://github.com/langgenius/mosoo/pull/608)

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
returned to operational. The original tenant's custom DeepSeek route has not
been re-tested because the investigating account lacks access. We therefore
report mitigation, not complete verification of every affected configuration.

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
specific historical 403 remains a supported hypothesis pending tenant re-test.

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

Three live acceptance scenarios passed: published Qwen, published native
DeepSeek, and Qwen Browser Preview. Each executed a harmless `printf` command
through bash, returned exit code 0, and reached a completed Run with the expected
final text. The custom namespaced model passed real CLI/ACP tool execution
against a deterministic upstream, but this is not live acceptance of the
original tenant's provider.

OpenCode's recovery did not establish recovery of the entire platform. At the
post-deployment check, separate OpenAI Runtime failures kept the aggregate
status degraded, while Claude had no fresh signal.

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
- [ ] Re-test the original custom-provider tenant's published and Preview paths
      with authorized access — tracked in #606; access and scheduling pending.
- [ ] Add sanitized capability-rejection diagnostics that identify the failed
      comparison without recording credentials or user content — tracked in
      #606; scheduling pending.

## Lessons

Provider selection and upstream model names are different identifiers, even
when both contain slashes. Test their relationship against real harness behavior
and keep permission checks strict. Track deployment and successful tool
execution separately from merge status and API health. Stale observations should
remain visibly unknown, and verified recovery should state its exact coverage.
