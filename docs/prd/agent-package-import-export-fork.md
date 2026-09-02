# Agent Import, Export, and Fork

Status: available with limits.

## Why it exists

Project owners often need to reuse an Agent without rebuilding its setup or
changing a working original. mosoo lets them carry the portable parts of an
Agent in a `.agent` file, or make a separate copy inside the same Project.

This is useful for moving a reusable setup between Projects, sharing it with
another Project owner, or testing a different direction while keeping the source
Agent intact.

## How to use it

- **Export:** Open Agent settings and choose **Export agent**. mosoo downloads a
  `.agent` file.
- **Import:** On the Agents page, choose **Import package** and select a
  `.agent` file. mosoo creates an editable draft in the selected Project, reports
  anything that needs attention, and lets the owner open the draft.
- **Fork:** Open Agent settings and choose **Fork agent**. mosoo creates a new
  draft in the same Project; the original Agent remains unchanged.

## Current limits

The core export, import, and fork flows are available. An Agent's main setup
and packaged Skills can travel with it.

A `.agent` file is not a Project backup or a snapshot of a running Agent. It does
not carry credentials, conversations, logs, usage history, or live runtime
state. External connections must be reconnected, and imported Environment
choices or secrets may need to be configured again. mosoo shows known issues
after import or fork, but owners finish repairs in the normal Agent editor.
