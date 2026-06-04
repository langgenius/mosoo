import { useEffect, useRef } from "react";

import type { ThreadListItem } from "./thread";

export function useSelectedThreadReadSync({
  markRead,
  onError,
  selectedThread,
}: {
  markRead: (input: { readAt: string; threadId: string }) => Promise<void>;
  onError: (error: unknown) => void;
  selectedThread: ThreadListItem | null;
}): void {
  const pendingReadMarkerRef = useRef<string | null>(null);
  const completedReadMarkersRef = useRef<Set<string> | null>(null);
  completedReadMarkersRef.current ??= new Set<string>();
  const completedReadMarkers = completedReadMarkersRef.current;

  useEffect(() => {
    if (selectedThread === null || selectedThread.read) {
      return;
    }

    const marker = `${selectedThread.id}:${selectedThread.lastActivityAt}`;

    if (pendingReadMarkerRef.current === marker || completedReadMarkers.has(marker)) {
      return;
    }

    pendingReadMarkerRef.current = marker;
    const threadToMark = selectedThread;

    async function markSelectedThreadRead(): Promise<void> {
      try {
        await markRead({
          readAt: threadToMark.lastActivityAt,
          threadId: threadToMark.id,
        });
        completedReadMarkers.add(marker);
      } catch (error) {
        onError(error);
      } finally {
        if (pendingReadMarkerRef.current === marker) {
          pendingReadMarkerRef.current = null;
        }
      }
    }

    void markSelectedThreadRead();
  }, [completedReadMarkers, markRead, onError, selectedThread]);
}
