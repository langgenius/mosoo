# Thread Files

Status: partially available.

## Why it matters

Builders often need an Agent to read a brief, dataset, or reference document and
keep useful output after a Run ends. Thread files give each conversation a
durable, bounded file context without implying that the whole Agent workspace is
saved.

## Who uses it

- Builders attach source material and review files created by the Agent.
- Authorized integrations attach, list, download, or delete files for Threads
  they can access.

## User flow

1. A Builder attaches files while starting a Thread or from an Agent session
   chat. An integration can attach a file when starting a Thread or sending a
   later message.
2. An attachment belongs to that Thread. Mosoo only promises to give the Agent
   files explicitly selected for the current message.
3. Outputs that Mosoo records from the Agent appear as artifacts in the same
   Thread. When an Agent reply links to a recorded `outputs/` file, selecting
   that link opens the artifact in a Thread preview drawer with a download
   action.
4. The Files page lets the Builder search, filter, preview supported formats,
   and download attachments and artifacts.

## Current experience and boundaries

Attachments and recorded artifacts outlive an individual Run. Other files in
the Agent's temporary workspace are not saved automatically. Earlier attachments
remain listed on the Thread, but they are not automatically included in a later
Run; the later message must reference them again through a surface that supports
attachments.

The new-Thread composer and Agent session chat support attachments. The main
Thread detail reply composer does not yet support them. The Files page has no
create, rename, move, delete, or shared-library controls.

Access follows the App and Thread: knowing a file identifier does not grant
access or enable cross-Thread sharing. Deleting a file through an authorized
integration, or deleting its Thread, is permanent from the user's perspective;
there is no trash or restore flow. This is not a certified secure-erasure
guarantee. Archived, rescheduling, and finished Threads remain readable, while
console attachment changes are blocked. Integration deletion does not yet apply
that lifecycle rule consistently.
