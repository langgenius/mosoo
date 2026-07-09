# Runtime Model Refresh Design

## Outcome

Mosoo exposes the current public OpenAI and Anthropic agent models without asking owners to understand vendor-specific implementation details. New Agents use balanced current defaults, Advanced runtime settings only offer valid single-Agent controls, and cost reporting uses official prices for the time of each run.

## Model catalog

- Add GPT-5.6 Sol, Terra, and Luna with their explicit model IDs.
- Make GPT-5.6 Terra the OpenAI default because it replaces GPT-5.4 at the same base token price while balancing capability and cost.
- Add Claude Sonnet 5 and Claude Fable 5. Make Sonnet 5 the Anthropic default.
- Do not add Claude Mythos 5 because it is invitation-only. There is no official model named Claude 5.5.
- Keep older model entries available for existing Agents and explicit selection.

## Advanced runtime settings

- Resolve Codex reasoning choices from the selected model, not only the runtime.
- GPT-5.6 exposes `low`, `medium`, `high`, `xhigh`, and `max`; older Codex models remain limited to their supported levels.
- Keep Codex `ultra` out of Advanced runtime settings because it enables automatic multi-Agent orchestration rather than only changing reasoning depth.
- Preserve Claude Agent SDK `low` through `max` effort and `maxTurns`; do not translate settings across runtimes.
- Use each selected model's native defaults so the Console does not show a value different from the one the runtime applies.

## Runtime compatibility

- Upgrade the bundled Codex runtime to `0.144.0`, the minimum client version declared for GPT-5.6.
- Upgrade Claude Agent SDK to `0.3.205`, which includes the current Claude 5 model and effort metadata.
- Keep `@anthropic-ai/sdk` unchanged because the current version satisfies the Agent SDK peer contract and Mosoo does not call it directly.

## Cost accuracy

- Add official GPT-5.6 and Claude 5 prices and correct stale GPT-5.4 prices found during the refresh.
- Select Claude Sonnet 5's introductory or standard price using the run timestamp; stored usage rows keep their price snapshot.
- Apply documented long-context multipliers to GPT models when the request crosses the published threshold.

## Verification

- Regenerate the runtime catalog and prove the committed generated artifact is current.
- Add focused catalog, Advanced settings, pricing, API, and Web tests.
- Run Driver install, typecheck, unit tests, and build after dependency changes.
- Run affected package typechecks/tests, then `just check` when local resources permit.
- No GraphQL or database schema changes are planned, so GraphQL codegen and DB regeneration should remain unnecessary.
