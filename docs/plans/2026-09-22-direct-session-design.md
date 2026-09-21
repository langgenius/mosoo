# Direct Session invocation

Status: the owner approved direct invocation as the primary experience on September 22, 2026. This plan records the implementation choices under that direction. It is not release evidence or approval for a production data migration.

## User contract

A backend with a Project key and configured model-provider credentials can select a supported harness and model, supply instructions, input, and files, and receive a durable Session. It does not first create or publish an Agent. An owned private Agent remains an optional reusable preset. Both paths preserve the same public ID, native context, working files, effective configuration, artifacts, events, usage, and cancellation behavior.

The request selects inline configuration or an Agent preset explicitly. It does not silently combine them. A new preset-based Session uses the latest saved configuration and freezes it; subsequent preset edits cannot modify the admitted Session. Public historical-version selection, in-Session model/harness changes, and interchangeable native contexts are outside this slice. Project credentials and turn budgets remain BYOK; #636 commercial supply and billing stay separate.

## Design choice

Use the existing Session execution kernel with two configuration sources. Resolve ownership and configuration once before admission, freeze one execution plan, and reuse the existing Run, file, event, budget, checkpoint, and retry paths.

Creating a hidden Agent per inline request would preserve the current coupling, produce misleading reusable resources, and complicate cleanup. A separate Router execution stack would duplicate durability and authorization. Neither is required for the approved experience.

Project is the authority for execution, credentials, and file ownership. An Agent association is optional provenance, not the owner of a Session. Inline Sessions must not invent an Agent ID or depend on an Agent row. The optional association must remain truthful through Session, Run, event, Driver, GraphQL, and public response contracts. Preserve historical non-null associations.

Keep existing v1 live-selection and identity behavior. Existing v2 Agent-scoped creation remains a preset adapter. Add Project-level v2 creation and file input through the same services; route terminology need not change. CLI login supplies an explicit owned Project, whereas a Project key remains bound to its own Project. Capability checks use the existing runtime catalog and provider resolution, with explicit rejection and no silent runtime or model substitution.

## Implementation sequence

1. Update canonical product and boundary documents before changing code. Record the latest scope in #582, #634, #639, #640 and the umbrella PR; previous saved-Agent acceptance is only partial evidence.
2. Remove runtime hydration's dependence on a mutable Agent for frozen Sessions. Resolve execution authority from the Session's Project and configuration from its execution snapshot. Preserve explicit legacy fallback reads for old snapshots; never fabricate missing configuration.
3. Make Agent provenance optional across stored execution records and Driver contracts, with an appended migration that preserves existing records and indexes. Verify data preservation, foreign-key behavior, and rollback on disposable copies before proposing production application. Match Host/Driver versions whenever their protocol changes.
4. Admit direct execution through a Project-scoped v2 create path. Normalize explicit harness/model selection, instructions, and file input into the same execution plan used by the preset path. Bind the entire normalized creation request into existing idempotency receipts; a retry returns the admitted snapshot even if a preset was edited meanwhile.
5. Regenerate public contracts and GraphQL where required. Update existing clients, CLI, executable HTTP examples, and documentation to lead with direct creation. Sessions with no preset must remain visible and operable in the Project console.
6. Verify real Codex and Claude Code tool execution, artifacts, same-ID cold continuation, Project boundaries, retries, and immutable effective configuration in isolated staging. Continue the independently required Cloud conversion, Type retirement, and coordinated release.

## Verification and completion

- Create and run with no Agent records in the Project; assert that no hidden Agent appears.
- Test unsupported harness/model selection, cross-Project resources, malformed and ambiguous configuration sources, and absent model credentials before execution admission.
- Repeat creation with an idempotency key; prove one Session and one initial Run. Reusing the key with changed configuration fails explicitly. Recover interrupted creation without selecting a newer preset.
- Run both supported acceptance harnesses with inexpensive configured models, a real tool call, verified artifacts, and a follow-up requiring original private workspace state after reclamation.
- Change the optional preset after Session creation; continuation retains the admitted configuration. Verify both fresh and cached hydration.
- Preserve v1 request/response and live-selection compatibility; v1 does not expose new direct v2 Sessions. Do not describe existing v1 saves as necessarily isolated behind a manual Publish action.
- Verify the full D1 migration chain and representative existing rows/relationships. A schema migration does not authorize production execution or restore missing historical state.

Existing persistence and Cattle checkpoint primitives predate #582 and are reused. Green unit tests, a saved-Agent run, or a successful backup alone do not complete direct Router acceptance. #582 remains open until the approved Cloud migration and matched API, Driver, CLI, and documentation release are verified.
