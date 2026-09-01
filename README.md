<p align="center">
  <img src="docs/assets/mosoo-banner.png" alt="mosoo" />
</p>

<h1 align="center">mosoo</h1>

<p align="center">
  <strong>An open-source agent runtime for coding agents.</strong><br />
  Run OpenAI Codex, Claude Agent SDK, and OpenCode behind API endpoints in isolated AI agent sandboxes.
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/langgenius/mosoo" alt="License" /></a>
  <a href="#product-status"><img src="https://img.shields.io/badge/status-alpha-orange" alt="Status: Alpha" /></a>
</p>

<p align="center">
  <a href="https://cloud.mosoo.ai">Try mosoo</a> ·
  <a href="https://mosoo.ai">Website</a> ·
  <a href="https://mosoo.ai/docs">API Documentation</a> ·
  <a href="https://github.com/langgenius/mosoo-agent-driver">mosoo-agent-driver</a> ·
  <a href="https://github.com/langgenius/mosoo-connector">mosoo-connector</a> ·
  <a href="https://github.com/langgenius/mosoo-skills">mosoo-skills</a>
</p>

mosoo provides a Cloudflare-native control plane to stream tool activity, inspect Run history, and keep Threads and files across executions. It is self-hostable in your own account.

Your application remains yours. Its backend owns product behavior and end-user access. mosoo focuses on Agent execution and lifecycle.

## How It Works

```text
configure Agent + Skills + MCP + provider
  -> preview and publish an Agent version
  -> call it from a backend or the mosoo console
  -> stream events, handle permission requests, inspect files and usage
  -> continue a durable Thread across Runs
```

## Features

What works today across the Agent runtime and API:

- **Agent runtime and control plane.** Configure and run OpenAI Codex, Claude Agent SDK, and OpenCode behind one normalized runtime protocol.
- **Agent API.** Start, follow, continue, stop, archive, and delete Agent work from a trusted backend.
- **AI agent sandboxes.** Stream responses and tool activity, handle permission requests, cancel work, and inspect diagnostics in isolated execution environments.
- **Durable work.** Keep Threads, Runs, events, and managed files across individual executions.
- **Agent observability.** Inspect Run status, replayable activity, diagnostics, and usage estimates; this is operational visibility, not a compliance audit trail or provider bill.

## Who It Is For

mosoo is for developers extending Codex, Claude Agent SDK, OpenCode, or another coding agent into products and automations who do not want to operate a separate agent runtime, Sandbox service, session store, file pipeline, and Agent API for every integration.

## Product Status

mosoo is in Alpha. The managed runtime and Agent API surfaces above are shipped and covered by repository tests, but production reliability and external adoption have not been proven. Public APIs and product behavior may still change.

## Getting Started

The fastest way to try mosoo is the hosted console at [cloud.mosoo.ai](https://cloud.mosoo.ai). To run it yourself, self-host from a clean clone as below.

### Prerequisites

- `bun >= 1.4.0-canary.1`
- `just >= 1.51`
- A Docker-compatible daemon for Agent runtime and Sandbox flows

### Run Locally

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

### Troubleshooting

If setup fails, start with the focused recipe: submodule issues use `git submodule update --init`, missing local secrets use `just env-init`, and D1 schema errors use `just db-migrate`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow and verification expectations.

## Example: Build a Codex Agent API

[Codex Pet](https://mosoo.ai/en/use-cases/codex-pet) shows a published mosoo Agent integrated into an existing product backend through the Thread API. The same API can expose Agents backed by Claude Agent SDK or OpenCode.

https://github.com/user-attachments/assets/4a4bbaab-c192-4462-99e0-020eab966fff

## Documentation

- API documentation: [mosoo.ai/docs](https://mosoo.ai/docs)
- Canonical product contract: [docs/SPEC.md](./docs/SPEC.md)
- Current implementation architecture: [docs/architecture.md](./docs/architecture.md)
- Production SLO and incident policy: [docs/operations/reliability.md](./docs/operations/reliability.md)
- PRD index and historical implementation contracts: [docs/prd/README.md](./docs/prd/README.md)

The public landing page and blog live in the private `langgenius/mosoo-website` repository and are deployed separately on `mosoo.ai`.

## Community & Support

- Bug reports and feature requests: [GitHub Issues](https://github.com/langgenius/mosoo/issues)
- Product updates: [mosoo.ai](https://mosoo.ai)

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow, commit policy, and verification expectations. Contributions are covered by the [Contributor License Agreement](./CLA.md); CLA Assistant will prompt you on your first pull request.

## Contributors

<a href="https://github.com/langgenius/mosoo/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=langgenius/mosoo" alt="mosoo contributors" />
</a>

## License

mosoo is licensed under the [Apache License 2.0](./LICENSE).
