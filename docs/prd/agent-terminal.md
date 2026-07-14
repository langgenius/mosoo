# Agent Terminal

Status: Available today for owners of Assistant Agents (Pet). It is not available for
Task Agents (Cattle).

## What it is

Terminal is a troubleshooting tool for an Agent's live environment. It helps an owner
understand why an Agent is not behaving as expected by checking its files, running
processes, and installed tools directly. This shortens diagnosis when Preview or Logs
do not provide enough context.

Terminal is an expert recovery surface, not the normal way to configure or publish an
Agent.

## How to use it

Open an Assistant Agent in the Mosoo console and select **Terminal**. Mosoo shows the
connection status and offers a reconnect action. The first connection may take a few
seconds while the Agent's environment wakes up.

Commands have broad access and can change the live environment. Owners should use the
Terminal for inspection or deliberate manual recovery, then make lasting product
changes through the Agent's normal configuration and publishing flows.

## Current limits

- Only the Agent owner can open the Terminal.
- Task Agents do not show it because their environments are temporary.
- Terminal changes may disappear after an environment is reset, rebuilt, or replaced.
- Mosoo does not promise a specific folder layout, source-code checkout, or set of
  maintenance commands inside the Terminal.
