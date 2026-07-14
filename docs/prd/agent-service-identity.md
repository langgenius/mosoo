# Agent Publishing and Versions

Status: core behavior is shipped, with known console gaps.

## Why this exists

A Builder can improve an Agent after people have started using it. Without a stable identity and saved releases, every edit could send users to a new Agent or silently change an existing conversation. Mosoo keeps the published Agent recognizable while separating its past and current behavior.

## Who uses it

The App Owner publishes and updates the Agent. App Users and authorized integrations use it without needing to follow every configuration change.

## How it works

1. The owner tests the Agent in Preview and publishes it when ready.
2. Publishing creates the first live version. People keep using the same Agent as later versions are released.
3. A new conversation uses the live version available when that conversation starts. An existing conversation stays tied to the version it began with, so later edits do not silently rewrite its behavior.
4. The owner can open Versions to see which version is live and review earlier releases.
5. Changes that would redefine the Agent itself, such as its type or runtime, cannot overwrite the published Agent. The owner forks a new draft and leaves the original Agent and its history intact.

## Current limits

The stable identity, version history, and per-conversation version choice are implemented for published Agents. Version history is view-only: there is no compare or restore action. Type switching has an assisted fork flow, but changing runtime still requires manually forking first and then editing the copy. Some console text says an owner must republish after a live edit even though the current save path already activates a new version; until that messaging is corrected, the release moment is not communicated consistently.
