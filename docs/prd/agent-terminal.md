# Agent Terminal — current product contract

Status: active and shipped for the Pet owner-debug Terminal. Cattle has no
Terminal entry point.

Exact behavior lives in the owner-debug terminal service, runtime kind policy,
and current Web Terminal implementation.

## One-line positioning

The Terminal gives an authorized Pet owner a direct PTY shell inside that
Agent's stable Cloudflare Sandbox for diagnosis and manual inspection. It is an
owner-debug surface, not Mosoo's canonical configuration or deployment path.

## Current behavior

- The Agent editor shows a flat **Terminal** tab for Pet Agents.
- Cattle Agents do not render the Terminal tab because their runtime Sandbox is
  Session-scoped and transient.
- Opening the tab connects to the Cloudflare Sandbox PTY through Mosoo's
  owner-authorized terminal route.
- The terminal session identity is stable for the owner/Agent pair. Cloudflare's
  PTY support supplies replay and multiple clients for that same session.
- The Web client exposes connection state and a reconnect action; a hibernated
  Sandbox may take time to wake.

The shell inherits the current Sandbox filesystem, installed tools, runtime
user, and lifecycle. Mosoo does not add a second command grammar or emulate a
terminal in the browser.

## Product boundaries

The Terminal is useful for inspecting processes, files, installed tools, or a
runtime incident. It does not make terminal edits authoritative:

- Agent config must be changed through the Agent editor and saved manifest.
- Session history and process events belong to **Logs**.
- Usage belongs to **Cost**.
- App source deployment belongs to **App Overview / Deployment**.
- Terminal mutations are not written back to the Product Manifest, an Agent
  package, or source repository.

No product contract guarantees paths such as `/workspace/logs/agent.log` or
`/workspace/config.yaml`, a resident Agent service to restart, or an Agent git
repository to pull. Those depend on what is actually present in a particular
Sandbox.

## Pet and Cattle

| Dimension              | Pet                   | Cattle                       |
| ---------------------- | --------------------- | ---------------------------- |
| Sandbox subject        | Stable Agent Sandbox  | Dedicated Session Sandbox    |
| Terminal tab           | Shipped               | Hidden                       |
| Inspection path        | Owner-debug PTY       | Session Logs and diagnostics |
| Durable product config | Agent Manifest/editor | Agent Manifest/editor        |

Hiding Terminal for Cattle prevents a false promise that a transient Session
Sandbox is a long-lived machine the owner can maintain.

## Explicitly not promised

- a daily-operations frequency or VPS maintenance workflow;
- predefined log/config paths or service commands;
- an Agent source checkout in `/workspace`;
- terminal changes surviving every rebuild, restore, or Sandbox replacement;
- independent per-tab PTYs (multiple clients attach to the stable session;
  users can run `tmux`/`screen` themselves when available).
