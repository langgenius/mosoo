import { useState } from "react";

import type {
  FileUploadRecoveryCandidate,
  FileUploadResumeResult,
} from "@/shared/lib/file-api-error";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import {
  discardStoredFileUploads,
  resumeStoredFileUpload,
} from "../../../domains/file/api/file-upload-recovery";
import { toFileId, toFileIds } from "../../../routes/typed-id";
import { isTruthy } from "../../../shared/lib/truthiness";

// Rendered only after the recovery scan finds at least one resumable upload.
// Splitting the dialog body out of the always-mounted gate keeps the Radix
// dialog primitive and the resume/discard upload paths out of the entry bundle
// that loads on every page.
export function UploadRecoveryDialogContent({
  initialCandidates,
}: {
  initialCandidates: FileUploadRecoveryCandidate[];
}) {
  const [open, setOpen] = useState(true);
  const [candidates, setCandidates] = useState<FileUploadRecoveryCandidate[]>(initialCandidates);
  const [recovering, setRecovering] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  async function handleContinueAll() {
    setRecovering(true);
    setSummary(null);

    let completedCount = 0;
    let terminalCount = 0;
    const retryableResults: {
      candidate: FileUploadRecoveryCandidate;
      result: FileUploadResumeResult;
    }[] = [];

    try {
      const settled = await Promise.all(
        candidates.map(async (candidate) => ({
          candidate,
          result: await resumeStoredFileUpload(toFileId(candidate.fileId)),
        })),
      );

      for (const { candidate, result } of settled) {
        if (result.status === "completed") {
          completedCount += 1;
          continue;
        }

        if (result.status === "removed_terminal") {
          terminalCount += 1;
          continue;
        }

        retryableResults.push({
          candidate,
          result,
        });
      }

      const nextCandidates = retryableResults.map((entry) => entry.candidate);
      setCandidates(nextCandidates);

      if (nextCandidates.length === 0) {
        setOpen(false);
      }

      const retryableCount = retryableResults.length;
      const summaryParts = [
        completedCount > 0
          ? `Recovered ${completedCount} upload${completedCount === 1 ? "" : "s"}`
          : null,
        terminalCount > 0 ? `${terminalCount} terminated` : null,
        retryableCount > 0 ? `${retryableCount} can still be retried` : null,
      ].filter(Boolean);

      setSummary(
        summaryParts.length > 0 ? `${summaryParts.join(", ")}.` : "No uploads need recovery.",
      );
    } finally {
      setRecovering(false);
    }
  }

  async function handleDiscardAll() {
    setRecovering(true);

    try {
      await discardStoredFileUploads(toFileIds(candidates.map((candidate) => candidate.fileId)));
      setCandidates([]);
      setSummary(null);
      setOpen(false);
    } finally {
      setRecovering(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[460px]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Resume unfinished uploads</DialogTitle>
          <DialogDescription>
            Found {candidates.length} unfinished upload{candidates.length === 1 ? "" : "s"}. If you
            continue, they will resume one by one while each upload keeps chunk-level concurrency.
          </DialogDescription>
        </DialogHeader>
        <div className="border-border-subtle bg-secondary/30 text-muted-foreground rounded-lg border px-3 py-2 text-sm">
          {candidates.length === 0
            ? "There are no uploads to recover right now."
            : candidates
                .slice(0, 5)
                .map((candidate) => candidate.fileName)
                .join(", ")}
          {candidates.length > 5 ? ` and ${candidates.length} files total` : ""}
        </div>
        {isTruthy(summary) ? <div className="text-muted-foreground text-sm">{summary}</div> : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setOpen(false);
            }}
            disabled={recovering}
          >
            Later
          </Button>
          <Button variant="outline" onClick={() => void handleDiscardAll()} disabled={recovering}>
            Discard all
          </Button>
          <Button
            onClick={() => void handleContinueAll()}
            disabled={recovering || candidates.length === 0}
          >
            {recovering ? "Resuming..." : "Resume all"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
