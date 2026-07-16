# <img src="apps/web/public/brand/logo-mark.svg" alt="" width="48" height="48" /> Mosoo

Mosoo is building the production path from runnable agentic-app prototypes to hosted web products that real users can sign in to and use.

Builders keep authoring with a local coding agent. The Mosoo Production Alpha target handles a strict repository contract, deterministic validation, isolated builds, App authentication, durable data and files, managed agent execution, observable Runs, enforceable confirmation gates, immutable Releases, and recovery.

```text
describe the business to Codex / Claude Code / OpenCode
  + use the Mosoo Build Skill and CLI
  -> produce a Deployable Repo that passes the Mosoo Contract
  -> deploy through Mosoo
  -> App Users sign in to the hosted App
```

<p align="center">
  <a href="https://try.mosoo.ai">Try Mosoo</a> ·
  <a href="https://mosoo.ai">Website</a> ·
  <a href="https://mosoo.ai/docs">API Documentation</a> ·
  <a href="https://github.com/langgenius/mosoo-connector">Mosoo Connector</a>
</p>

## Who It Is For

Mosoo is for independent builders and small teams that already use local coding agents to make working software but do not want to become the DevOps, backend, and security team for every App.

The narrow first use case is an existing runnable App that combines ordinary web behavior with one agentic business workflow. The Builder keeps using their preferred local coding agent; Mosoo starts where local authoring ends.

## Product Status

Mosoo is being reset around this production path. The canonical target contract is [docs/SPEC.md](./docs/SPEC.md). Existing Agent-first, Thread-first, and public-GitHub-Web-artifact behavior in the repository is migration input, not the desired product model when it conflicts with that Spec.

The launch standard is **Production Alpha**: isolation, durable state, recoverability, and portability are hard requirements; SLA, compliance certification, custom infrastructure, and reversal of already-completed business side effects are not promised yet. This repository does not claim stable APIs or backward compatibility while the migration is in progress.

Product and engineering references:

- Canonical product contract: [docs/SPEC.md](./docs/SPEC.md)
- PRD index and historical implementation contracts: [docs/prd/README.md](./docs/prd/README.md)
- Current implementation architecture: [docs/architecture.md](./docs/architecture.md)
- Development and contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md)

## Use Cases

- [Codex Pet — Agent as API](./examples/use-cases/codex-pet.md): publish one Mosoo Agent, then let Codex integrate it into an existing product backend.

## Local Development

Prerequisites:

- `bun >= 1.4.0-canary.1`
- `just >= 1.51`
- Docker Desktop for Agent runtime and Sandbox flows

From a clean clone:

```bash
git clone --recurse-submodules https://github.com/langgenius/mosoo.git
cd mosoo
just setup
just dev
```

`just setup` installs dependencies, initializes submodules, creates or completes `apps/api/.dev.vars`, installs Git hooks, and applies pending local D1 migrations. `just dev` reapplies pending migrations before starting the web and API development servers.

Local URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:8787`

Minimum smoke:

```bash
curl http://localhost:5173/api/health
curl http://localhost:8787/api/health
```

API health is `/api/health`, not `/health`. The current Mosoo control-plane development login uses OTP; under local loopback origins, addresses ending with `@mosoo.ai` skip that OTP and log in directly. This is separate from the target per-App Auth Realm.

If setup fails, start with the focused recipe: submodule issues use `git submodule update --init`, missing local secrets use `just env-init`, and D1 schema errors use `just db-migrate`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow and verification expectations.

The public landing page and blog live in the private `langgenius/mosoo-website` repository and are deployed separately on `mosoo.ai`.
