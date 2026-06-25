import { ignorePromiseRejection } from "@mosoo/effects";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import type { FileUploadRecoveryCandidate } from "@/shared/lib/file-api-error";

import { inspectRecoverableFileUploads } from "../../../domains/file/api/file-upload-recovery";

// The dialog body is only needed when the scan actually finds resumable
// uploads, which is the uncommon case. Loading it lazily keeps the Radix dialog
// primitive and the resume/discard upload paths out of the entry bundle that
// loads on every page; the lightweight scan still runs eagerly on mount.
const UploadRecoveryDialogContent = lazy(async () => {
  const content = await import("./upload-recovery-dialog-content");
  return { default: content.UploadRecoveryDialogContent };
});

export function UploadRecoveryDialog() {
  const scannedRef = useRef(false);
  const [candidates, setCandidates] = useState<FileUploadRecoveryCandidate[] | null>(null);

  useEffect(() => {
    if (scannedRef.current) {
      return;
    }

    scannedRef.current = true;

    inspectRecoverableFileUploads()
      .then((result) => {
        if (result.candidates.length > 0) {
          setCandidates(result.candidates);
        }
      })
      .catch(ignorePromiseRejection);
  }, []);

  if (candidates === null) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <UploadRecoveryDialogContent initialCandidates={candidates} />
    </Suspense>
  );
}
