# Skills

Status: Shipped for App owners, with important editing gaps.

## Why it matters

A Skill lets a Builder reuse trusted instructions and supporting files across Agents without copying prompts by hand. Skills are for the person who owns and configures an App; App Users do not manage them.

## Current user flow

1. Open **Skills** in the active App.
2. Choose **Add skill**. Upload a `.md`, `.zip`, or `.skill` file, or import from GitHub or skills.sh. mosoo previews the name, description, and author before adding it.
3. Open a Skill card to read its main instructions. From this view, the owner can download, fork, or uninstall it.
4. Open an Agent, add one or more Skills from that App, and save the Agent.
5. When a new Session starts, its attached Skills become available to the Agent. The Agent reads a Skill only when the task calls for it.

Importing an Agent can also add Skills bundled with it to the destination App. If a referenced Skill is absent, the import reports the gap instead of borrowing a Skill from another App.

## Current availability and boundaries

- Each Skill belongs to one App. Only that App's owner can view, download, fork, uninstall, or attach it. There is no sharing or cross-App catalog.
- There is no in-app editor and no user-facing update action. The detail view currently offers only **Download**, **Fork**, and **Uninstall**. Revising a Skill means editing it locally, adding it as a new Skill, and updating Agent attachments manually.
- Fork creates an independent App-local copy. It does not stay in sync with its source, and deleting the source does not delete the copy.
- Uninstall does not list affected Agents. The Skill disappears from the registry, while affected Agents show it as **Missing**. New Sessions skip it with a warning; existing Sessions keep the configuration they started with. Saving an affected Agent removes the missing attachment.
