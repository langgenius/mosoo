# Agent Terminal

Status: retained for owners of existing shared Agent workspaces during the #582 Cloud transition. Newly created configuration uses Session-owned workspaces and has no Agent-level Terminal.

## What it is

Terminal is a troubleshooting tool for an Agent's live environment. It helps an owner
understand why an Agent is not behaving as expected by checking its files, running
processes, and installed tools directly. This shortens diagnosis when Preview or Logs
do not provide enough context.

Terminal is an expert recovery surface, not the normal way to configure or publish an
Agent.

## How to use it

Open an existing shared Agent in the mosoo console and select **Terminal**. mosoo shows the
connection status and offers a reconnect action. The first connection may take a few
seconds while the Agent's environment wakes up.

Commands have broad access and can change the live environment. Owners should use the
Terminal for inspection or deliberate manual recovery, then make lasting product
changes through the Agent's normal configuration and publishing flows.

## Current limits

- Only the Agent owner can open the Terminal.
- Session-owned workspaces do not expose an Agent-level Terminal. Their durable state still continues through the same Session; this is independent of live container lifetime.
- Terminal changes may disappear after an environment is reset, rebuilt, or replaced.
- mosoo does not promise a specific folder layout, source-code checkout, or set of
  maintenance commands inside the Terminal.
