# Mosoo

Language: [Simplified Chinese](./docs/README.zh-Hans.md)

Mosoo is an open-source Agent Cloud project in alpha, built on a Cloudflare-native architecture. The current priority is OPC / personal developers: people should be able to run a lightweight, self-hostable, fast-moving Agent Cloud in their own Cloudflare account with low operational overhead.

In the long term, we want Mosoo to grow from an open-source community edition into Agent infrastructure that supports individuals, OPCs, small teams, and enterprise governance. Personal developers can experiment and fork freely, teams can build shared Agent and Knowledge assets, and enterprises can add permission, cost, version, and runtime-state management.

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

Mosoo continues to evolve around three planes:

- **Consumption plane**: let users access Agents through natural entry points.
- **Production plane**: let application / Agent developers configure, launch, and distribute Agents faster.
- **Governance plane**: let administrators manage permissions, cost, versions, and runtime state.

During the open-source alpha, the consumption, production, and governance planes are focused on personal developers and small-scale self-hosting first. We will satisfy real individual and OPC needs before extending the same architecture toward team collaboration and enterprise governance.

## Roadmap

Mosoo's main direction is still moving quickly. We are currently focusing on the Cloudflare-native open-source version so the core loop can close in a lighter, faster, and more verifiable way: make personal developer and OPC scenarios genuinely usable first, then extend the same architecture toward team and enterprise support.

The current roadmap centers on these goals:

- **OPC / personal developers first**: polish the full loop for deploying, configuring, running, and debugging Agents as an individual developer.
- **Cloudflare-native runtime**: continue converging the architecture around Workers, Durable Objects, D1, R2, and related platform capabilities.
- **Complete open-source community path**: prioritize the core capabilities required for a self-hostable, modifiable, extensible community edition.
- **Agent asset management**: gradually turn Agent, Knowledge, Skill, MCP, Space, Credential, and Channel capabilities into manageable assets.
- **Enterprise capability expansion**: after personal and OPC scenarios work end to end, add team collaboration, permissions, cost, version control, and runtime governance.

The chart uses two states only: a node is **started** (any concrete artifact landed — merged PR, code on main, frozen PRD) or **not started**. Any item that previously read "in progress" is split into the slice that actually shipped and the slice that has not begun. Work that has been moved to post-mvp-polish or deferred outside this roadmap is not shown.

```mermaid
flowchart TD
  classDef started fill:#d4edda,stroke:#28a745,color:#155724
  classDef notstarted fill:#f8f9fa,stroke:#adb5bd,color:#495057,stroke-dasharray:4 3

  Base["Completed foundation<br/>M1B session snapshot / lifecycle / runtime state ops<br/>M2 / M2P / M2D minimum slices"]:::started
  OrgKind["M0I Org Kind / CE Slots<br/>kind + slot enforced (#93 #105)"]:::started

  Base --> DiagShipped["M2X Agent Page Operations / Runtime Diagnostics<br/>Terminal v1.2 (#249) / System Log v1.1 (#235) / File Browser v1.2 (#256)<br/>Session Log v1.5 grill + impl (#321 / #327) / Runtime Logs v2 first round (#310)"]:::started
  DiagShipped --> DiagVersions["M2X-V Versions<br/>PRD-D frozen, deferred to Phase 3"]:::notstarted

  Base --> Gov["M2G Governance foundation<br/>RBAC trio + errorMessage redaction shipped<br/>v1 released and ready"]:::started
  Base --> Api["M2D-H Published API hardening<br/>gap entry point retired before Public Thread API pivot"]:::started
  Api --> ThreadApi["M2D-V2 Public Thread API pivot<br/>/tasks wrapper removed before release (61a6e7b4 serves only as removal evidence)<br/>long-term POST /threads + GET /threads/{id}<br/>Channel auth handled separately via Installation / Binding"]:::started
  Base --> Provider["M2P-H Provider readiness fallback UX<br/>missing-key / wrong-key two states + vendor error pass-through"]:::started

  Provider --> SubOAuth["M2P-O Vendor Subscription OAuth Credential<br/>Claude Max / ChatGPT subscriptions directly driving Mosoo Agent<br/>research ready, deferred to V2+, PRD to be split out"]:::notstarted
  Gov --> SubOAuth

  OrgKind --> Gov
  OrgKind --> Cli
  Gov --> ThreadApi

  Api --> Cli["M2C Managed Mosoo CLI<br/>authenticated managed-entity operations"]:::notstarted
  Gov --> Cli
  Provider --> Cli

  Gov --> DiagShipped
  DiagShipped --> ByoEnv["M2E BYO Runtime Environment<br/>local / self-hosted cloud agent loop hooked into the governance plane<br/>can ship in V2, PRD to be split out"]:::notstarted
  Gov --> ByoEnv

  Gov --> Cost["M3B Cost coverage<br/>cost implementation shipped"]:::started

  Gov --> SysCommunity["M3A System Agent — community implementation<br/>configuration copilot for Agent Builder merged into the repo"]:::started
  Provider --> SysCommunity
  DiagShipped --> SysCommunity
  SysCommunity --> SysFormal["M3A System Agent — formal PRD + controlled Draft patch<br/>refactor community impl into a controlled Draft patch<br/>formal PRD to be written"]:::notstarted
  Cli --> SysFormal
  ThreadApi --> SysFormal
  ByoEnv --> SysFormal

  ThreadApi --> ChannelCore["M4-0 Channels<br/>Slack / Lark / Telegram / Discord / WeChat owner setup + backend shipped"]:::started
  Gov --> ChannelCore
  ChannelCore --> Im["M4A Channel runtime<br/>Discord real smoke / personal WeChat live smoke / LINE<br/>independent PRD per provider"]:::notstarted
  Im --> Work["M4B Linear / GitHub<br/>different surface family, drafted independently"]:::notstarted

  DiagShipped --> Vendors["M6 Multi-vendor expansion<br/>baseline in place, horizontal expansion not started"]:::notstarted
  Provider --> Vendors
  Gov --> Vendors
  Cli --> Vendors
  ByoEnv --> Vendors

  %% --- Pet/Cattle orthogonal fork (2026-05-09 decision, 2026-05-10 PRD locked, cross-node increment) ---
  Base -.Manifest kind + sandbox subject shipped.-> PCCore["M-PC Pet/Cattle — core contract (#126)<br/>Manifest kind + Configure selector + Publish visibility + Reset hidden + Lock+Fork<br/>Sandbox subject shipped"]:::started
  PCCore --> PCAdapt["M-PC Pet/Cattle — kind-aware downstream integrations<br/>Channel default + Billing dimension + System Agent inference<br/>awaiting kind-aware implementation"]:::notstarted
  PCAdapt -.channel default kind split.-> ChannelCore
  PCAdapt -.kind-aware billing dimension.-> Cost
  PCAdapt -.kind inference backfill.-> SysFormal

  Base --> MemoryBase["M2M Cross-session Memory — runtime base<br/>Pet sandbox /workspace/home symlink persistence<br/>runtime-native memory (no Groots-defined format)"]:::started
  MemoryBase --> MemoryPrd["M2M Cross-session Memory — PRD<br/>Pet canonicalization + Cattle no-memory boundary contract<br/>PRD to be split out"]:::notstarted
  DiagShipped --> MemoryPrd
  PCAdapt -.memory semantics.-> MemoryPrd
  MemoryPrd --> SysFormal
  MemoryPrd --> Vendors
```

## Vision

In the long term, Mosoo aims to grow from an open-source Agent Cloud project into a management-oriented platform rather than a pure tool. This vision is aimed at internal enterprise AI governance and Agent infrastructure management, letting application / Agent developers, administrators, and users participate in the same AI infrastructure from different perspectives.

For producers, the future goal is to complete application configuration and launch within 15 minutes, delivering different kinds of Agent Runtime to employees, such as Claude Code and Hermes. Mosoo should also connect to channels / platforms such as GitHub, Slack, and Lark, or integrate into internal enterprise systems and application development workflows through APIs and Skills.

For administrators, Mosoo aims to provide an easy-to-use WebUI for understanding which Agents are running inside the company, who can access them, who is using them, how cost is calculated, how versions are controlled, and how internal Agent infrastructure becomes managed infrastructure.

## Project Status

Mosoo is still in alpha exploration. Product boundaries, data models, deployment methods, and management experience are all evolving quickly. This repository currently prioritizes fast validation and architectural convergence for the open-source version, with no promise of stable APIs or backward compatibility.

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
