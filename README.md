# <img src="apps/web/public/brand/logo-mark.svg" alt="" width="48" height="48" /> Mosoo

Mosoo is an open-source, cloud-native platform for turning AI app ideas into
live agent apps: bring your PRD, use the Mosoo CLI and Codex skill, run OpenAI
runtime, Claude Agent SDK, or OpenCode/DeepSeek via ACP in isolated sandboxes,
manage their lifecycle, and deploy through the Mosoo Web console.

<p align="center">
  <a href="https://try.mosoo.ai">Try Mosoo</a> ·
  <a href="https://mosoo.ai">Website</a> ·
  <a href="https://mosoo.ai/docs">API Documents</a> ·
  <a href="https://github.com/langgenius/mosoo-connector">Mosoo Connector</a>
</p>

## Product Status

Mosoo is still in alpha exploration. Product boundaries, data models, deployment methods, and management experience are all evolving quickly. During the App boundary cut, treat [SPEC.md](./docs/SPEC.md) and [App Boundary](./docs/prd/app-boundary.md) as newer than older Agent-first, Workspace, member-management, or team-governance language. This repository currently prioritizes fast validation and architectural convergence for the open-source version, with no promise of stable APIs or backward compatibility.

- PRDs and product design: [docs/prd/README.md](./docs/prd/README.md).
- Current product spec: [SPEC.md](./docs/SPEC.md).
- Architecture design: [docs/architecture.md](./docs/architecture.md).
- Development and contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md).

## Local Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full development flow.

Prerequisites:

- `bun >= 1.4.0-canary.1`
- `just >= 1.51`
- Agent runtime / sandbox flows also need Docker Desktop.

From a clean clone:

```bash
git clone --recurse-submodules https://github.com/langgenius/mosoo.git
cd mosoo
just setup
just dev
```

`just setup` installs dependencies, initializes submodules, creates or completes
`apps/api/.dev.vars`, installs Git hooks, and applies the pending local D1
migration chain. `just dev` reapplies pending local migrations before starting
the web and API dev servers.

Local URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:8787`

The public landing page and blog live in the private `langgenius/mosoo-website` repository and are deployed on `mosoo.ai`.

Minimum smoke:

```bash
curl http://localhost:5173/api/health
curl http://localhost:8787/api/health
```

API health is `/api/health`, not `/health`. Regular email login uses OTP; under local loopback origins, addresses ending with `@mosoo.ai` skip OTP and log in directly.

If setup fails, start with the focused recipe: submodule issues use `git submodule update --init`, missing local secrets use `just env-init`, and D1 schema errors use `just db-migrate`. For details and verification expectations, read [CONTRIBUTING.md](./CONTRIBUTING.md).
