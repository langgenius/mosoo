# Agent File Browser — for humans

> This is the product-story version aimed at non-engineer readers. For the full engineering contract, see the Agent File Browser PRD.

---

## Positioning in one sentence

Mosoo File Browser exposes the **file system view that ships with the Cloudflare Sandbox** directly to **Pet** agent owners. **We do not re-implement a file manager; we simply wrap whatever `ls` returns inside the sandbox in a read-only web viewer.** CF provides primitives such as `readFile` and `exec("ls")`, and on top of them we add ownership validation, a Monaco text preview, Space deep links, and color coding to distinguish persistence.

**The File Browser entry point is not shown in the front end for Cattle agents** (see "Why Cattle has no File Browser" below).

> **The scope of this PRD ≠ a homegrown file manager.** Readers who expect to drag, rename, or upload "like macOS Finder / VS Code Explorer" will be disappointed — our goal is "let the Pet owner clearly see what is in the sandbox."

---

## VPS mental model (Pet only)

> Imagine you SSH into Railway / Fly.io / a personal VPS and run `cd /workspace && ls -la` — what you see is exactly this.

Your Mosoo **Pet** agent is that VPS. **The File Browser is the equivalent of "running `ls` in the browser"** — it is not an upload / edit / management tool, it is a **viewing** tool. Pet owners typically open it at these moments:

- **Right after publishing**: confirm that Skill files and runtime materialization outputs landed where expected
- **Seeing what the agent left behind**: after running for a few days, inspect logs / intermediate files / temporary configs in the session working directory
- **Confirming where a Space is mounted**: you mounted a Space but are unsure which path it landed on → open it and take a look
- **Helping with debugging**: the Logs tab shows "wrote to /workspace/memory/foo.md", so you go to the File Browser to confirm the file exists

**Frequency order of magnitude** (the norm for Pet users):

- Each Pet owner opens the File Browser **3–5 times per week** (far below the Terminal's "3–10 times per day" — most daily ops happen in the Terminal)
- Each visit lasts **1–3 minutes** (you leave as soon as you have confirmed)
- It is not daily ops, but it is a **high-value confirmation tool at publish / debug moments**

**Mosoo File Browser ≠ a file management tool; it = the window through which you confirm "is the sandbox really what I think it is right now?"**

---

## Why Cattle has no File Browser

A Cattle agent is a "task-oriented / one-shot worker" (see [`./agent-type.md`](./agent-type.md)) — **each session gets its own isolated sandbox, and the sandbox is destroyed when the task ends.**

| Dimension          | Pet                                  | Cattle                                            |
| ------------------ | ------------------------------------ | ------------------------------------------------- |
| Sandbox lifecycle  | Long-lived, follows the agent        | Born and dies with the session                    |
| Home mental model  | "My VPS / my home"                   | "One instance per task"                           |
| File persistence   | Persists across sessions (memory)    | Wiped after the run — nothing to "view long-term" |
| File Browser value | High (see the current state of home) | Very low (there is no "home" to view)             |

A Cattle owner who wants to see how a task executed → uses the **Logs tab** and selects the specific session. To view shared read-only material → uses the **Space**.

**Keeping a File Browser entry point would make Cattle owners expect that "I can `ls` my home too"**, but Cattle simply has no "home" — opening it would hit an empty / terminated sandbox, an experience worse than "not seeing the entry point at all."

> ⚠️ This conflicts with the old decision in [`./agent-type.md`](./agent-type.md) §N7  "Debug nav is identical across Pet/Cattle", and aligns with the direction of PRD-A v1.2 Cattle Terminal hide. A drift note will be flagged when agent-type-prd is merged.

---

## A typical File Browser journey (Pet owner)

```mermaid
journey
    title A Pet owner's two File Browser sessions within one week
    section Mon 14:02 · confirmation after publish
      Publish completes, jump back to agent detail page: 4: Alice
      Debug → File System shows the tree (colors + ↗): 5: Alice
      Expand memory/, click a generated Skill file, view it in Monaco: 5: Alice
      Cmd-F search "tone", jump to the paragraph: 5: Alice
      Expand the active session, view agent.log: 4: Alice
      Wants to delete a stale file, no toolbar button → understands: 3: Alice
      Click Space ↗, jump to the Space page: 4: Alice
    section Wed 11:15 · debug missing
      Logs tab shows an error: welcome.md missing: 3: Alice
      File System expands memory/prompts, confirms it is missing: 4: Alice
      Back in Studio, edit the Manifest and publish again: 4: Alice
      File Browser [Refresh], welcome.md appears: 5: Alice
```

Each Pet owner runs a similar journey **3–5 times per week**. It is not daily ops; it is a **high-leverage** confirmation tool at publish / debug moments.

> Cattle agent owners do not see the File System entry point in the Debug menu; to view a session's intermediate artifacts they use the Logs tab.
