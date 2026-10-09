# Thread Files

What files a Thread holds, what the Agent can read, and how files are removed.

## Promises

- A Thread's files are its attachments plus the artifacts the Agent records. Both outlive the Run that used or produced them.
- An attachment belongs to one Thread. During a turn whose message carries attachments, the Agent can read all of the Thread's attachments, read-only.
- Files the Agent writes under `outputs/` become downloadable artifacts. Other workspace files are restored with the Session's checkpoint for continuation, but are not listed or downloadable.
- Access follows the Project and the Thread: knowing a file ID grants nothing, and files are never shared across Threads.
- Deleting a file, or the Thread that holds it, is permanent. There is no trash or restore.
- Archived and terminated Threads reject every file change, including deletes through the API.

## Limits

- A turn whose message carries no attachment cannot read earlier attachments directly; they stay in the workspace only if the Agent copied them there.
- In the console, attachments can be added when starting a Thread and in Preview, but not in a follow-up to a Thread in Runs. The API accepts attachments on creation and on follow-up messages.
- The Files page searches, filters, previews and downloads. It cannot upload, rename, move or delete files, and there is no shared library.
- An API upload is a single request of at most `PUBLIC_THREAD_FILE_UPLOAD_MAX_BYTES`.
- The end-of-turn scan of `outputs/` records at most `RUNTIME_SESSION_OUTPUT_SCAN_MAX_FILES` files, in path order; a file past that limit is listed only if the runtime reported writing it.
- Deleting a file removes it from the Thread, not from the Agent's workspace: copies there stay in the Session's checkpoint, and an artifact still under `outputs/` is recorded again when the next turn ends.
