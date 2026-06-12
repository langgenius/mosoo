# Mosoo

Mosoo is an open-source Agent Cloud project in alpha, built on a Cloudflare-native architecture. The current priority is OPC / personal developers: a user should be able to bring a `PRD.md`, invoke `@mosoo`, and get a running Agent App with Mosoo Agent services, app-local resources, Cloudflare-native deployment, and a public preview URL.

During the current construction phase, assume one human owns one Organization. The Organization is the account / billing / tenant shell; the business and delivery boundary is **Project** in code, database, API, and architecture docs, and **App** in console copy. Team membership, project roles, org-wide asset libraries, and enterprise governance remain future extensions after the single-owner Project/App loop is real.

In the long term, we want Mosoo to grow from an open-source community edition into Agent infrastructure that supports individuals, OPCs, small teams, and enterprise governance. Personal developers can experiment and fork freely, teams can build shared Agent and Knowledge assets, and enterprises can add permission, cost, version, and runtime-state management on top of the same boundary model.

## Current Product Lock

- The primary loop is `PRD.md + @mosoo` -> create or select an App -> provision Agent services and app-local resources -> deploy a Web shell -> return a public preview URL.
- Project is the canonical engineering noun. App is the user-facing console noun. Avoid introducing parallel nouns such as Workspace, Team, Application, or Agent Service for this boundary.
- Agents, Threads / Sessions, Spaces, Environments, Skills, MCP servers, Provider keys, deployment state, and app-scoped cost belong to the Project/App boundary first.
- The console should create a default App during onboarding. If an Organization has one App, route directly into that App; the App list only becomes prominent when there is a second App.

## What Is Mosoo

The name Mosoo comes from Moso Bamboo.

Moso bamboo grows differently from many trees. It does not slowly create new cells while rising upward; it completes a long preparation underground first:

1. Underground rhizomes and roots accumulate nutrients for years.
2. After the shoot emerges, it rapidly stretches existing cells.
3. It completes almost all of its height growth in only 40-60 days.

Moso bamboo is one of the fastest-growing large woody bamboos and is often treated as a symbol of rapid vertical growth. It never appears alone; it grows as a bamboo forest. In Chinese culture, bamboo also carries the meaning of humility, resilience, and long-termism.

We want Mosoo to grow in the same way: first taking root in the developer and OPC communities, letting a lightweight open-source version grow quickly; then gradually hardening over a longer period, helping teams and enterprises transform as Agent and Knowledge assets expand, and eventually growing into an Agent forest owned by each organization.

## Why We Are Building It

Mosoo was originally named Dify-Lite. The initial goal was to build a lighter version of Dify: reduce the overall feature surface, use a technology stack and engineering tradeoffs oriented toward 2026, and lower the barrier to adoption.

The value proposition at this stage is not to clone a complete large platform. It is to make the Agent Cloud skeleton thin, fast, and open-source first, so personal developers can own infrastructure that is runnable, understandable, and easy to fork.

Mosoo still has three long-term planes, but the current alpha should express them through the Project/App delivery loop first:

- **Consumption plane**: let users access an App's published Agent services through natural entry points.
- **Production plane**: let personal developers configure, launch, and distribute Agent Apps faster.
- **Governance plane**: start with owner-visible app health, cost, and deployment facts; expand to administrators, members, permissions, and compliance after the single-owner loop works.

During the open-source alpha, the consumption, production, and governance planes are focused on personal developers and small-scale self-hosting first. We will satisfy real individual and OPC needs before extending the same architecture toward team collaboration and enterprise governance.

## Roadmap

Mosoo's main direction is still moving quickly. We are currently focusing on the Cloudflare-native open-source version so the core loop can close in a lighter, faster, and more verifiable way: make personal developer and OPC scenarios genuinely usable first, then extend the same architecture toward team and enterprise support.

The current roadmap centers on these goals:

- **OPC / personal developers first**: polish the full loop for creating, deploying, running, and debugging one Agent App as an individual developer.
- **Cloudflare-native runtime**: continue converging the architecture around Workers, Durable Objects, D1, R2, and related platform capabilities.
- **Complete open-source community path**: prioritize the core capabilities required for a self-hostable, modifiable, extensible community edition.
- **Project/App resource boundary**: move Agent, Thread / Session, Space, Environment, Skill, MCP, Provider Credential, deployment state, and app-scoped Cost under one delivery boundary.
- **Enterprise capability expansion**: after personal and OPC scenarios work end to end, add team collaboration, permissions, cost governance, version control, and runtime governance.

For the current status snapshot — what is **Planned**, **In Development**, and **Done** — see [roadmap.md](./roadmap.md).

## Vision

In the long term, Mosoo aims to grow from an open-source Agent Cloud project into a management-oriented platform rather than a pure tool. This vision is aimed at internal enterprise AI governance and Agent infrastructure management, letting application / Agent developers, administrators, and users participate in the same AI infrastructure from different perspectives.

For producers, the future goal is to complete application configuration and launch within 15 minutes, delivering different kinds of Agent Runtime to employees, such as Claude Code and Hermes. Mosoo should also connect to channels / platforms such as GitHub, Slack, and Lark, or integrate into internal enterprise systems and application development workflows through APIs and Skills.

For administrators, Mosoo aims to provide an easy-to-use WebUI for understanding which Agents are running inside the company, who can access them, who is using them, how cost is calculated, how versions are controlled, and how internal Agent infrastructure becomes managed infrastructure.

## Project Status

Mosoo is still in alpha exploration. Product boundaries, data models, deployment methods, and management experience are all evolving quickly. During the Project/App separation, treat the current lock above and [Project / App Boundary](./dev/prd/project-app-boundary.md) as newer than older Agent-first, Workspace, member-management, or team-governance language. This repository currently prioritizes fast validation and architectural convergence for the open-source version, with no promise of stable APIs or backward compatibility.

- PRDs and product design: [dev/prd/README.md](./dev/prd/README.md).
- Architecture design: [dev/architecture.md](./dev/architecture.md).
- Development and contribution guide: [CONTRIBUTING.md](./docs/CONTRIBUTING.md).

## Local Development

See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for the full development flow. The shortest local path is:

```bash
bun install
vp run env:init
vp exec prek -c dev/config/prek.toml install
vp run db:migrate:local
just dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:8787`
- Regular email login uses OTP.
- In local development, email addresses ending with `@mosoo.ai` skip OTP and log in directly.
