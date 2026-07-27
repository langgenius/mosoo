<p align="center">
  <img src="https://github.com/user-attachments/assets/4986c4b8-28fa-45ea-9be9-78c1c7133128" alt="mosoo" width="96" height="96" />
</p>

# mosoo

**An open-source agent runtime for coding agents.**

Run OpenAI Codex, Claude Agent SDK, and OpenCode behind API endpoints in isolated AI agent sandboxes.

mosoo provides a Cloudflare-native control plane to stream tool activity, inspect Run history, and keep Threads and files across executions. It is self-hostable in your own account.

Your application remains yours. Its backend owns product behavior and end-user access. mosoo focuses on Agent execution and lifecycle; App Deployment is a separate Alpha surface, not the core product contract.

```text
configure Agent + Skills + MCP + provider
  -> preview and publish an Agent version
  -> call it from a backend or the mosoo console
  -> stream events, handle permission requests, inspect files and usage
  -> continue a durable Thread across Runs
```

<p align="center">
  <a href="https://try.mosoo.ai">Try mosoo</a> ·
  <a href="https://mosoo.ai">Website</a> ·
  <a href="https://mosoo.ai/docs">API Documentation</a> ·
  <a href="https://github.com/langgenius/mosoo-connector">mosoo Connector</a>
</p>

## Agent Runtime and API: What Works Today

- **Agent runtime and control plane.** Configure and run OpenAI Codex, Claude Agent SDK, and OpenCode behind one normalized runtime protocol.
- **Agent API.** Start, follow, continue, stop, archive, and delete Agent work from a trusted backend.
- **AI agent sandboxes.** Stream responses and tool activity, handle permission requests, cancel work, and inspect diagnostics in isolated execution environments.
- **Durable work.** Keep Threads, Runs, events, and managed files across individual executions.
- **Agent observability.** Inspect Run status, replayable activity, diagnostics, and usage estimates; this is operational visibility, not a compliance audit trail or provider bill.

## Who It Is For

mosoo is for developers extending Codex, Claude Agent SDK, OpenCode, or another coding agent into products and automations who do not want to operate a separate agent runtime, Sandbox service, session store, file pipeline, and Agent API for every integration.

## Product Status

mosoo is in Alpha. The managed runtime and Agent API surfaces above are shipped and covered by repository tests, but production reliability and external adoption have not been proven. Public APIs and product behavior may still change.

Product and engineering references:

- Canonical product contract: [docs/SPEC.md](./docs/SPEC.md)
- PRD index and historical implementation contracts: [docs/prd/README.md](./docs/prd/README.md)
- Current implementation architecture: [docs/architecture.md](./docs/architecture.md)
- Development and contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md)

## Example: Build a Codex Agent API

[Codex Pet](./examples/use-cases/codex-pet.md) shows a published mosoo Agent integrated into an existing product backend through the Thread API. The same API can expose Agents backed by Claude Agent SDK or OpenCode.

https://github.com/user-attachments/assets/4a4bbaab-c192-4462-99e0-020eab966fff

## Local Development

Prerequisites:

- `bun >= 1.4.0-canary.1`
- `just >= 1.51`
- A Docker-compatible daemon for Agent runtime and Sandbox flows

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

API health is `/api/health`, not `/health`. The mosoo control-plane development login uses OTP; under local loopback origins, addresses ending with `@mosoo.ai` skip that OTP and log in directly.

If setup fails, start with the focused recipe: submodule issues use `git submodule update --init`, missing local secrets use `just env-init`, and D1 schema errors use `just db-migrate`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow and verification expectations.

The public landing page and blog live in the private `langgenius/mosoo-website` repository and are deployed separately on `mosoo.ai`.
