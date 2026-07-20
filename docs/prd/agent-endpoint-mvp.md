# Agent API Endpoint

Status: shipped as a current integration surface.

## Purpose

Builders can use an Agent configured in mosoo inside an existing product or
automation. Publishing makes the Agent callable from the Builder's backend,
while mosoo handles execution, Threads, and files. The Builder does not need to
build and operate the Agent's execution system.

## Who it is for

This surface is for a mosoo App owner integrating their own backend. Current
calls use an API token tied to the owner's mosoo account. They cannot represent
individual people using the Builder's product.

## How it works

1. Configure and test the Agent in Preview, then publish it.
2. Create an API token in Settings. The console provides an API reference and
   copyable coding-agent instructions.
3. A backend can start a Thread with a message and optional files, follow up,
   observe results as they arrive, stop work, and manage the Thread and files.

mosoo runs the published Agent settings; callers cannot customize the Agent for
individual requests. Re-publishing updates future Threads, while an existing
Thread keeps the configuration it started with.

## Current boundaries

- Only a published, ready Agent can be called. Unpublishing stops API access.
- Only the Agent's App owner can call it with the current token model.
- This is a backend integration surface, not anonymous access, App User
  authentication, or App deployment.
- Exact request and response details belong in the API reference, not this PRD.
