# Thread Files

Status: partially available.

## Why it matters

Builders often need an Agent to read a brief, dataset, or reference document and
keep useful output after a Run ends. Thread files give each conversation a
durable, reviewable file surface. They are distinct from the private Thread
workspace checkpoint used to continue a Task Agent.

## Who uses it

- Builders attach source material and review files created by the Agent.
- Authorized integrations attach, list, download, or delete files for Threads
  they can access.

## User flow

1. A Builder attaches files while starting a Thread or from an Agent session
   chat. An integration can attach a file when starting a Thread or sending a
   later message.
2. An attachment belongs to that Thread. mosoo only promises to give the Agent
   files explicitly selected for the current message.
3. Outputs that mosoo records from the Agent appear as artifacts in the same
   Thread. When an Agent reply links to a recorded `outputs/` file, selecting
   that link opens the artifact in a Thread preview drawer with a download
   action.
4. The Files page lets the Builder search, filter, preview supported formats,
   and download attachments and artifacts.

## Current experience and boundaries

Attachments and recorded artifacts outlive an individual Run. A Task Agent's
private Thread checkpoint separately restores the complete working directory for
continuation, including files that were not promoted to artifacts. That checkpoint
is not a browseable file library and does not create `file_record` entries.
Earlier attachments remain listed on the Thread, but they are not included in a
later Run unless that message references them again through a surface that
supports attachments; the attachment mount itself is excluded from checkpoints.

The new-Thread composer and Agent session chat support attachments. The main
Thread detail reply composer does not yet support them. The Files page has no
create, rename, move, delete, or shared-library controls.

Access follows the Project and Thread: knowing a file identifier does not grant
access or enable cross-Thread sharing. Deleting a file through an authorized
integration, or deleting its Thread, is permanent from the user's perspective;
there is no trash or restore flow. This is not a certified secure-erasure
guarantee. Archived, rescheduling, and finished Threads remain readable, while
console attachment changes are blocked. Integration deletion does not yet apply
that lifecycle rule consistently.
