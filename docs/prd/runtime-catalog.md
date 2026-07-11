# Runtime Catalog Extension PRD

Status: implementation guide for runtime expansion.

> Adjacent docs: [Architecture](../architecture.md), [Runtime Session Kernel](./runtime-session-kernel.md), [Credentials](./credentials.md)

## One-Line Positioning

Add or change an Agent runtime, Provider, model source, or display surface by updating the product runtime catalog and, for launchable runtimes, the independent Driver provider registry. A cross-submodule conformance test keeps their shared runtime, transport, and capability contract aligned.

## 1. User Problem

Mosoo users see runtime and Provider availability in Agent creation, model selection, and Provider setup. Before this catalog boundary, those surfaces could drift because runtime/model allowlists, display names, icon mapping, Provider cards, and custom model entry points lived in separate handwritten code paths.

The person extending Mosoo needs a predictable answer to one question:

> "What must change when we add a runtime or Provider, and how do we prove every surface saw the same change?"

## 2. Goal

When a maintainer adds a runtime, they should be able to:

- Declare runtime identity, transport, visibility, providers, defaults, supported models, and display metadata in the runtime catalog source.
- Declare first-class Provider identity, credential environment, default endpoint, auth shape, icon key, model source, and runtime adapter profile in the same source.
- Keep Mosoo product-facing Provider ids under Mosoo control, even when upstream model metadata comes from another registry name such as `models.dev`.
- Generate a typed catalog artifact consumed by API and Web code.
- Keep executable Driver backend registration owned by the standalone Driver repository.
- Keep planned display-only runtimes separate from public runtime release gates.
- Validate that runtime admission, available model calculation, Provider card rendering, icon rendering, custom model entry points, coming-soon display, and the Driver's executable runtime contract do not drift.

## 3. In Scope

- One canonical product catalog source for runtime admission, Provider, model, model-source, adapter, and display metadata used by API and Web.
- One Driver-owned provider registry for executable backends and the capabilities each backend actually advertises.
- A checked cross-submodule contract requiring every public product runtime to match one Driver registry entry by runtime id, transport, and capability status/version.
- Generated TypeScript constants committed with the repository.
- API model availability uses the generated Provider model catalog plus runtime allowlists and App-level Provider credentials.
- Web runtime options, default runtime selection, brand icon lookup, Provider cards, and the custom OpenAI-compatible entry point consume runtime catalog exports.
- OpenCode model availability is the union of compatible models from configured first-class Providers, OpenCode Zen, and App-defined OpenAI-compatible custom credentials.
- Planned runtime metadata may exist in the catalog without becoming launchable. No current landing/App Overview showcase is wired to that metadata.
- A repeatable extension checklist for adding a new runtime.

## 4. Out Of Scope

- Pricing catalog migration. Model pricing remains in the cost domain until cost reporting needs the same generator boundary.
- Real-time model discovery from external model databases or Provider `/models` endpoints on every model picker render.
- Remote runtime marketplace or user-installed runtime definitions.
- Runtime-specific Driver implementation details. A catalog entry can expose a runtime only after the Driver path exists and is release-gated.
- Per-App custom runtime definitions.

## 5. Concept Definitions

| Concept                  | Product definition                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime                  | A launchable Agent driver choice shown to users, such as Claude Agent SDK, OpenAI Runtime, or OpenCode.                                              |
| Transport                | The control path Runtime uses to talk to the Driver backend, such as `claude-agent-sdk`, `openai-app-server`, or `acp-fallback`.                     |
| Provider                 | A Mosoo product-facing credential provider that can back one or more runtimes. Its id is chosen by Mosoo, not by an upstream registry.               |
| Adapter profile          | The provider-specific protocol shape a runtime backend must render, such as OpenAI Responses API, Anthropic Messages, or OpenAI-compatible base URL. |
| Provider model source    | Metadata describing where Mosoo can import or refresh a Provider's model list, such as a `models.dev` provider id or a Provider `/models` endpoint.  |
| Provider model           | A known model option shipped by Mosoo for a first-class Provider.                                                                                    |
| Custom OpenAI-compatible | App-defined credentials with user-provided Base URL and Model IDs. It is an action entry point, not a fixed Provider card.                           |
| Public runtime           | A runtime visible and selectable in Agent creation whose shared identity, transport, and capabilities match an executable Driver registry entry.     |
| Internal runtime         | A cataloged runtime that is not user-selectable.                                                                                                     |
| Planned runtime          | Non-launchable roadmap metadata. The current Web landing/App Overview showcase does not consume it.                                                  |
| Icon key                 | A catalog-owned symbolic key that Web maps to an imported brand asset.                                                                               |

## 6. Relationship Lock

```mermaid
flowchart LR
  Source["runtime-catalog.jsonc<br/>human-maintained source"] --> Generate["catalog generator<br/>validate + emit TS"]
  Generate --> TS["catalog.generated.ts<br/>committed typed artifact"]
  TS --> RuntimeCatalog["runtime-catalog package<br/>provider + runtime admission + display exports"]
  RuntimeCatalog --> API["API<br/>available models + credential hydration"]
  RuntimeCatalog --> Web["Web<br/>provider cards + runtime options + display"]
  DriverSource["Driver provider-registry.ts<br/>executable backends + capabilities"] --> Driver["standalone Agent Driver"]
  RuntimeCatalog --> Conformance["cross-submodule conformance test"]
  DriverSource --> Conformance
  Conformance --> ReleaseGate["public runtime release gate"]
```

Key decisions:

- Display-only planned runtimes sit beside public runtime display entries, but they do not enter runtime admission.
- The product catalog and Driver registry are deliberately separate ownership surfaces. Neither is described as a generated copy of the other; the pinned Driver gitlink plus the conformance test is the release boundary.
- Mosoo Provider ids are product identities. For example, Mosoo may use `gemini`, `qwen`, `kimi`, `zhipu`, and `minimax` even when an upstream registry uses `google`, `alibaba`, `moonshotai`, `zai`, or regional variants as source ids.
- Upstream source names belong in catalog metadata such as `modelSource`, not in API/Web/Driver branching logic.

## 7. Extension Flow

1. Add or edit vendors, models, runtime entries, and planned display entries in `pkgs/runtime-catalog/catalog/runtime-catalog.jsonc`.
2. If adding a Provider, choose the Mosoo product-facing `vendorId`, set the Provider card label/icon, declare credential env vars, default endpoint, auth header shape, optional `modelSource`, and any runtime-specific adapter profile.
3. If the runtime is launchable, set `visibility` to `public`, choose a supported `transport`, declare `vendorIds`, `defaultIdentity`, `supportedModels`, and whether App-defined OpenAI-compatible custom credentials are admitted.
4. If the runtime is only roadmap display, add it to `plannedRuntimes` with explicit `surfaces`.
5. Add an icon asset only if the catalog `iconKey` is new. Prefer existing `@lobehub/icons-static-svg` assets before adding local SVGs.
6. For a launchable runtime, add or update the executable backend descriptor in `apps/driver/src/runtimes/provider-registry.ts`, including the runtime id, transport, and capability statuses. Commit that change in the standalone Driver repository and update the main repository's Driver gitlink.
7. Run `vp run --filter @mosoo/runtime-catalog catalog:generate`.
8. Run `vp run --filter @mosoo/runtime-catalog test` and the affected API/Web type checks. The package test compares every public catalog runtime with the pinned Driver registry and fails on missing, extra, or mismatched entries.
9. Do not make a runtime public until the Driver backend exists and the cross-submodule contract passes.

## 7.1 Provider Identity And Model Source Rule

Provider ids are Mosoo product ids. They should be stable, readable, and aligned with what users expect to see in Provider setup. Mosoo does not need to mirror an upstream registry's provider id when that id is more implementation-oriented than product-oriented.

Examples:

| Mosoo Provider id | User-facing label | Possible upstream model source                               |
| ----------------- | ----------------- | ------------------------------------------------------------ |
| `gemini`          | Gemini            | `models.dev` provider `google`                               |
| `qwen`            | Qwen              | `models.dev` provider `alibaba` or regional Alibaba variants |
| `kimi`            | Kimi              | `models.dev` provider `moonshotai`                           |
| `zhipu`           | Zhipu             | `models.dev` provider `zai` or `zhipuai`                     |
| `minimax`         | MiniMax           | `models.dev` provider `minimax` or regional MiniMax variants |

This is not a runtime mapping layer. The catalog generator may use `modelSource` to import or refresh Provider model metadata, but generated Mosoo artifacts should expose Mosoo Provider ids to API, Web, and Driver code.

## 7.2 Provider Cards And Custom Provider Entry

First-class Provider cards should be rendered from catalog metadata and treated equally in the Providers page. The initial public set is expected to include Anthropic, OpenAI, DeepSeek, Gemini, Qwen, Kimi, Zhipu, MiniMax, and OpenCode Zen, each with an icon key and Provider credential affordance.

OpenAI-compatible custom credentials are different:

- They are created from a top-level action such as "Add custom model" or "Add OpenAI-compatible provider".
- They require Name, API key, Base URL, and at least one Model ID.
- They should not appear as a fixed `openai-compatible` Provider card.
- Their models are App-defined and should be included only for runtimes that explicitly accept custom OpenAI-compatible credentials.

## 7.3 Runtime Model Availability Rule

Available models are computed by runtime, not by Web UI components. The Web model picker asks the API for `availableAgentModels`; the API resolves that list from:

1. Generated Provider model catalog entries.
2. App-level Provider credentials.
3. Runtime provider/model admission rules.
4. App-defined OpenAI-compatible custom credential model IDs when the runtime accepts them.

The availability key is `(providerId, modelId)`, not only `modelId`, because the same upstream model id may be reachable through multiple credentials, billing paths, or endpoints.

For OpenCode (`acp-fallback`), the model list should be the union of:

- Compatible models from configured first-class Providers.
- Models from configured OpenCode Zen.
- Models from configured custom OpenAI-compatible credentials.

OpenCode must therefore declare `acceptsCustomProvider: true` only when API hydration can render custom OpenAI-compatible credentials into a valid OpenCode provider config, including package and Base URL settings such as `@ai-sdk/openai-compatible` and `baseURL`.

## 7.4 Provider And Adapter Decision Rule

When adding a model source, first decide the identity boundary:

- Add a new **Vendor** when credentials, billing, model ownership, or user-facing provider identity differ. DeepSeek is a vendor because it uses `DEEPSEEK_API_KEY`, DeepSeek-owned models, and a DeepSeek API base.
- Add or reuse an **Adapter profile** when the same runtime transport must render a different protocol config for that vendor. If OpenCode already ships a native provider such as DeepSeek, Mosoo should use the native provider shape and avoid an adapter shim.
- When an OpenCode upstream provider id differs from the Mosoo Provider id, keep the Mosoo `vendorId` as the product identity and set the adapter's OpenCode provider id in the catalog. For example, Mosoo `zhipu` renders as OpenCode `zai/...` while credentials and UI remain `zhipu`.
- Do not encode a vendor as another vendor's model prefix. `opencode/deepseek-v4-pro` means OpenCode Zen owns the credential and endpoint; `deepseek/deepseek-v4-pro` means DeepSeek owns them, even if OpenCode launches the ACP process.
- OpenAI can have multiple adapter profiles across runtimes: the OpenAI Runtime path uses the OpenAI runtime / Responses-style backend contract, while ACP fallback may use OpenCode-native or OpenAI-compatible config. The provider id remains `openai`; the adapter profile changes by runtime path.

## 8. Acceptance Criteria

- Changing a runtime label, Provider card label, icon key, planned surface, default model, Provider model source, adapter profile, or supported model list requires one source edit plus regeneration.
- A planned runtime remains non-launchable; displaying it anywhere requires an explicit consumer and test.
- A public runtime appears in Agent runtime options and API available-model calculations from the same catalog entry.
- Every public runtime matches exactly one pinned Driver provider descriptor by runtime id, transport, and capability id/status/version; internal or planned catalog entries are not Driver-admitted.
- First-class Provider cards render from catalog metadata, with icons, without Web-only hard-coded Provider lists.
- The fixed `openai-compatible` Provider card is absent; custom OpenAI-compatible credentials are reachable from a top-level custom model/provider action.
- OpenCode availability reflects all configured compatible Provider credentials, not only the first Provider listed on the runtime.
- OpenCode model picker entries include the union of compatible first-class Provider models, OpenCode Zen models, and custom OpenAI-compatible model IDs.
- OpenCode is represented as the public runtime `acp-fallback`, not as a separate planned `opencode` runtime id.
- Generated catalog checks fail when the committed artifact is stale; the Driver conformance test fails when either registry advances without the matching pinned contract update.

The App Overview installer is a Codex-specific skill setup plus a shell-usable
Mosoo CLI. It is not a runtime-catalog surface and must not be expanded into a
coding-harness compatibility list without per-harness install and smoke tests.

## 9. Reasoning Review

The deleted assumption is that each surface can safely hard-code runtime or Provider metadata because the list is small. That did not hold once OpenCode became partially public while roadmap displays still existed and Provider cards expanded beyond OpenAI and Anthropic.

The MVP should not perform live external model discovery during normal UI rendering. It can, however, use external sources such as `models.dev` or Provider `/models` endpoints as catalog import inputs. Mosoo only needs the models and providers it can actually admit, credential, price, and run. Pricing migration is deferred because cost semantics have separate accounting risks and should move only when the cost domain is ready to consume the same source boundary.
