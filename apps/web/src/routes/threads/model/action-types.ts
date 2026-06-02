import type { ThreadListItem } from "./thread";

export interface ThreadFollowUpInput {
  body: string;
  thread: ThreadListItem;
}
