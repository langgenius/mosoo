# Agent API Endpoint

Status: shipped as a current integration surface.

## Purpose

Builders can use an Agent configured in mosoo inside an existing product or
automation. Publishing makes the Agent callable from the Builder's backend,
while mosoo handles execution, Threads, and files. The Builder does not need to
build and operate the Agent's execution system.

## Who it is for

This surface is for a mosoo Project owner integrating their own backend. Current
calls use an API key bound to exactly one Project. They cannot represent
individual people using the Builder's product.

## How it works

1. Configure and test the Agent in Preview, then publish it.
2. Create an API key in the selected Project’s settings. The console provides an API reference and
   copyable coding-agent instructions.
3. A backend can start a Thread with a message and optional files, follow up,
   observe results as they arrive, stop work, and manage the Thread and files.

mosoo runs the published Agent settings; callers cannot customize the Agent for
individual requests. Re-publishing updates future Threads, while an existing
Thread keeps the configuration it started with.

## Current boundaries

- Only a published, ready Agent can be called. Unpublishing stops API access.
- Application keys can call only Agents in their own Project. An owner can also use a distinct CLI login credential.
- This is a backend integration surface, not anonymous access or Project User
  authentication.
- Exact request and response details belong in the API reference, not this PRD.
