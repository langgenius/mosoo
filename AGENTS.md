# AGENTS.md

## Project Notes

- Development, verification, commit, and PR rules live in `docs/CONTRIBUTING.md`.
- Before coding, read the relevant documents under `dev/` to understand system boundaries, module relationships, and design intent.
- When boundaries are clear and maintenance cost stays reasonable, split subpackages to avoid large modules without clear ownership.
- Reusable coding-agent skills live under `.claude/skills` (a symlink into the `.skills/mosoo-skills` submodule, sourced from `langgenius/mosoo-skills`). Run `git submodule update --init` once so they resolve. Prefer an existing skill over re-deriving the same guidance; see `docs/CONTRIBUTING.md` → "Agent Skills".

## Engineering Guidance

- Before implementation, prefer using available tools to inspect related code, best practices, and library documentation so boundaries and rationale are clear.
- By default, inspect the file hierarchy around the current change. If files carry too many responsibilities, unclear names, or blurry directory boundaries, split, rename, and organize them along the way. Keep names short, direct, and predictable.
- Put shared contracts, cross-package payloads, and public schemas in shared packages only when they clearly cross boundaries. Keep app-local types, view models, and implementation details inside their owning module.
- Before adding DTOs, types, or constants, reuse existing shared contracts and module exports to avoid redefining the same concept.
- Keep `TypeScript` strict with clear boundaries. Do not introduce `any`. Export APIs should prefer semantically clear named types instead of complex inline types that pollute interfaces.
- Separate pure transformation logic from I/O, framework lifecycles, and platform APIs. Avoid circular dependencies and keep responsibilities focused.
- Keep platform implementations at platform boundaries. Shared packages must remain runtime-neutral and must not leak Node-only, browser-only, or mobile-specific dependencies into incompatible runtimes.
- Keep the runtime dependency graph on a consistent public export surface. Do not mix source-only and dist-only artifacts on the same path. When downstream code depends on compiled output, build upstream packages before starting downstream apps.
- Required business values and invariants should fail fast. Do not hide problems behind broad `try/catch`, silent fallbacks, or placeholder defaults.
- Keep one canonical naming scheme or command grammar for each user concept, avoiding multiple names that make docs, implementation, and tests drift apart.
- Commit messages must strictly follow `Conventional Commits`. Avoid vague, casual, or inconsistent titles.
- Commit messages must at least satisfy `type(scope): subject`. Use `!` only for intentional breaking changes, and keep `type`, `scope`, and `subject` semantically accurate.

## Monorepo Scaling And Performance Constraints

- Design database queries explicitly around access paths. Prefer `ORDER BY id` for list sorting, and do not default to `ORDER BY created_at`. ORM layers must not hide default filters or sorting; query conditions must be declared at the call site.
- Do not use full `count()` queries to calculate total pages for very large tables. Prefer cursor pagination, remove useless joins, and use database estimates when necessary. ORM relations must be explicitly preloaded; N+1 queries in loops are forbidden.
- All imports must stay at the top of the file. Inline imports are forbidden. Surface circular dependencies early through startup or build-time errors.
- Data models should carry only data and local invariants. Put complex business orchestration in verb-level services or modules instead of continuing to expand model methods.
- Avoid low-value third-party libraries. Prefer implementing small generic logic inside the repository. For third-party service integrations, prefer lightweight handwritten API clients instead of bulky vendor dependencies.
- Frontend API access must be generated from backend schema/codegen and stay strongly typed. Do not handwrite a parallel request layer. Avoid overusing React Context; high-frequency shared state should prefer fine-grained subscription tools such as zustand.
- Caching must not hide inefficient SQL or incorrect modeling. For user-personalized data, separate shared data pools from user-local data at the query layer.

## Protocol And Data Structure Design Guidance

Based on RFC 3117, RFC 5218, and RFC 6709, use these abstract constraints:

- Solve real problems first. Prefer existing protocols, formats, and conventions. Do not invent a new protocol without clear benefit.
- Keep semantics simple and singular. Common paths must be direct, and each capability should have one primary way to do it.
- Treat interoperability as the first goal. Semantics, boundaries, errors, state changes, and compatibility strategies must be clear.
- Default to backward compatibility. New fields and extensions should not break old implementations, and unknown content needs explicit handling rules.
- Keep extension points few and explicit. Reserve them only for foreseeable needs, and do not use extensions to create private forks or incompatible variants.
- Design version, number, and parameter spaces for long-term evolution. Avoid bit widths that are too small, exhausting number spaces, or ambiguous version semantics.
- Security capabilities must be negotiable and migratable, and no extension may weaken the original security model.
- During design, account for deployment cost, scale limits, performance inflection points, and pressure on shared infrastructure.
