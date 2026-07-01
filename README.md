# Mosoo

## Product Status

Mosoo is still in alpha exploration. Product boundaries, data models, deployment methods, and management experience are all evolving quickly. During the App boundary cut, treat [SPEC.md](./docs/SPEC.md) and [App Boundary](./docs/prd/app-boundary.md) as newer than older Agent-first, Workspace, member-management, or team-governance language. This repository currently prioritizes fast validation and architectural convergence for the open-source version, with no promise of stable APIs or backward compatibility.

- PRDs and product design: [docs/prd/README.md](./docs/prd/README.md).
- Current product spec: [SPEC.md](./docs/SPEC.md).
- Architecture design: [docs/architecture.md](./docs/architecture.md).
- Development and contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md).

## Local Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full development flow. The shortest local path is:

```bash
just setup
just dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:8787`
- Blog: `http://localhost:4321/blog`
- Regular email login uses OTP.
- In local development, email addresses ending with `@mosoo.ai` skip OTP and log in directly.
