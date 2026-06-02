import { useEffect, useRef } from "react";

import { getNotificationPermission } from "./format";
import type { ThreadBucket, ThreadListItem } from "./thread";

export function useThreadCompletionNotifications(threads: readonly ThreadListItem[]): void {
  const previousBucketsRef = useRef<Map<string, ThreadBucket> | null>(null);

  useEffect(() => {
    const nextBuckets = new Map(threads.map((thread) => [thread.id, thread.bucket]));
    const previousBuckets = previousBucketsRef.current;
    previousBucketsRef.current = nextBuckets;

    if (previousBuckets === null || getNotificationPermission() !== "granted") {
      return;
    }

    const created: { notification: Notification; onClick: (event: Event) => void }[] = [];

    for (const thread of threads) {
      const previousBucket = previousBuckets.get(thread.id) ?? null;

      if (previousBucket === "working" && thread.bucket === "completed" && !thread.read) {
        const notification = new globalThis.Notification("Thread completed", {
          body: `${thread.title} · ${thread.statusLine} by ${thread.agentName}`,
          tag: thread.id,
        });
        const threadId = thread.id;
        const onClick = (): void => {
          globalThis.window.focus();
          globalThis.window.location.assign(`/threads/${threadId}`);
        };
        notification.addEventListener("click", onClick);
        created.push({ notification, onClick });
      }
    }

    return () => {
      for (const { notification, onClick } of created) {
        notification.removeEventListener("click", onClick);
      }
    };
  }, [threads]);
}
