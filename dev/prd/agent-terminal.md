# Agent Terminal — for humans

> This is the product-story version for non-engineering readers. The full engineering contract lives in the draft PRD.

---

## One-line positioning

Mosoo Terminal exposes the **root shell experience that ships natively with the Cloudflare Sandbox** directly to **Pet** agent owners. We **don't reimplement a terminal — we just wire up CF's capabilities correctly**: CF provides the PTY, automatic replay, multi-client support, lazy-wake, and exponential backoff; we add ownership checks, reconnect keep-alive, and honest copy.

**Cattle agents do not surface a Terminal entry point in the frontend** (see "Why Cattle has no Terminal" below).

> **The scope of this PRD is NOT a home-grown terminal.** Readers who expect "a product-grade shell like Vercel's" will be disappointed — our goal is "let Pet agent owners use, correctly, the capabilities the CF Sandbox already provides."

---

## The VPS-ops mental model (Pet only)

> Picture yourself running an OpenClaw or Hermes agent on a VPS: every day you SSH in to take a look, fix one thing, install a tool.

Your Mosoo **Pet** agent is that VPS. **The Terminal is the shell you use to operate it day to day** — not a hideaway entry point you only open for the occasional debug session. A Pet owner may open the Terminal multiple times a day:

- **First thing in the morning**: check what the agent did overnight, whether it threw any errors, and how much space the cache is using.
- **During the day**: notice the agent is stuck → `tail -f` the logs / `ps aux` to check processes / kill and restart.
- **Fixing things**: `vim /workspace/config.yaml` to change a line, then restart the service.
- **Updating**: `apt install` a missing tool, `pip install` a new dependency, `git pull` the agent repo.

**Frequency reference** (the norm when running an AI agent on a VPS):

- Each Pet owner opens the Terminal 3-10 times per day.
- Hundreds of reconnects accumulate per week (WiFi blips, laptop waking from sleep, switching tabs, switching between desktop and laptop).
- Multiple tabs in parallel: a split between monitoring and running commands is the default workflow.

**Mosoo Terminal is NOT an emergency debug tool; it IS the shell for your daily ops (Pet only).**

---

## Why Cattle has no Terminal

A Cattle agent is a "task-oriented / one-shot worker" (see [`./agent-type.md`](./agent-type.md)): **each session gets its own isolated sandbox, and the sandbox is destroyed when the task ends**. This is the exact opposite of a Pet:

| Dimension           | Pet                           | Cattle                                                                       |
| ------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| Sandbox lifecycle   | Long-lived, follows the agent | Born and dies with the session                                               |
| Ops mindset         | "My VPS / my coworker"        | "One instance per task"                                                      |
| Cross-session state | Yes (agent state preserved)   | No (only the Space plus the platform-saved conversation)                     |
| Terminal value      | High (daily maintenance tool) | Low (every sandbox is different, so there's nothing to "maintain long-term") |

A Cattle owner who wants to inspect task execution → goes to the **Logs tab** and picks a specific session (each session has its own log). A Cattle owner who wants to change something → edits the agent manifest / config and republishes.

**Keeping a Terminal entry point (even with a tooltip) would give Cattle owners the false expectation that "I can go into the sandbox and tinker."** Opening it would hit a generic error — a worse experience than "never seeing the entry point at all."

> ⚠️ This conflicts with the old [`./agent-type.md`](./agent-type.md) §N7  decision that "the Debug nav is identical across Pet and Cattle."  prioritized nav consistency at the time to avoid drift; the Terminal is now specialized as a "honest UX fit > nav consistency" exception. The agent-type PRD needs a drift note that references this PRD.

---

## A day in the life of Terminal usage (Pet owner)

```
09:15  Bob opens Pet agent X → Debug → Terminal
       Sees that tail -f /workspace/logs/agent.log is still running
       The cursor is still where it was last evening (CF replay restores it automatically)

09:18  Bob switches to another browser tab to handle a PR review
       (the Terminal tab sits idle in the background)

09:35  Bob returns to the Terminal tab → the xterm body still shows the 09:15 content plus the new logs that arrived in between
       He keeps working without losing context

10:02  He spots an ERROR block → cat /workspace/config.yaml
       Sees that system_prompt has a wrong line → vim to fix → :wq
       Triggers the restart command inside the sandbox

11:30  Bob opens a second tab for the same agent → it also connects to the same PTY (CF-native multi-client)
       The two tabs stay in sync in real time (Q3=A: v1 defaults to shared;
       to get parallel, independent shells, open tmux/screen inside the sandbox)

14:48  WiFi blips → the connection badge goes gray → CF's built-in backoff reconnects automatically
       A few seconds later it's green again → the xterm content is intact and new output keeps streaming in

16:20  A partner messages Bob that the agent is erroring → he switches to his laptop →
       opens Mosoo → the same Terminal → sees the live state from the desktop session
       (cross-device continuity, thanks to a sessionId that is stable per owner+agent)

```

A Pet owner **runs through this journey 3-10 times a day**, scaled by the number of Pet agents per team × the number of Pet owners.

> Cattle agent owners don't see a Terminal entry in the Debug menu; to inspect session behavior they go to the Logs tab.

---

## The 4 things we build

We cut the 11-14 dev-days envisioned in v1.0 down to ~1.75 dev-days, doing only the 3 things — plus 1 frontend gate — that make **frequent, VPS-style use genuinely smooth for Pet owners**:

### (1) No content lost after reconnect

After you switch tabs / hit a network blip / wake from sleep / switch WiFi and return to the Terminal, the **xterm body, cursor position, and prior output** are fully preserved.

**How we do it**: we don't reimplement scrollback — we **wire up the CF Sandbox's native replay**. A stable session id lets CF recognize you as "a different client of the same terminal" and automatically inject the output buffered in its memory.

### (2) Real-time multi-tab sync (CF-native, 0 engineering)

Two tabs viewing the same agent's Terminal stay in **real-time input/output sync**.

**How we do it**: we don't write a BroadcastChannel — we **use the CF Sandbox's native multi-client support**: a stable session id makes the two tabs different clients of the same PTY.

> ⚠️ If your workflow is "tab A runs tail -f / tab B runs commands" — i.e. parallel **independent** shells — v1 does not support per-tab independent PTYs by default. Open `tmux` or `screen` inside the sandbox to split windows yourself.

### (3) Honest copy for the first few seconds

A sandbox that hasn't been used in a week will hibernate; after you click Terminal, CF takes a few seconds to lazy-wake it. The copy tells you "it takes a few seconds to wake the sandbox the first time," so you don't think the system has crashed.

**How we do it**: we don't write a 5s timer — we **rely on the backoff retry built into the CF SandboxAddon**. If it truly can't connect, just click the existing reconnect button at the top.

### (+1) Cattle does not show a Terminal entry

A Cattle agent's Debug menu does not render the Terminal item. Cattle owners never see this entry point, which avoids creating a false expectation.

---

## The boundaries at a glance

This product has several ops tools. Don't mix them up:

| What you want to do                                                         | Which one to use                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| See what events recently happened on this agent's machine (Pet only)        | **Debug → System Log** ([for-humans](./agent-runtime-logs.md))           |
| See what messages / tool calls a given session ran (Pet + Cattle)           | **Logs tab** → pick a session                                            |
| Open a root shell to debug / maintain the sandbox (**Pet only, daily ops**) | **Terminal tab** (this PRD)                                              |
| See an agent's version history and roll back to an older version            | **Versions tab** ([for-humans](./agent-versions.md), currently deferred) |
