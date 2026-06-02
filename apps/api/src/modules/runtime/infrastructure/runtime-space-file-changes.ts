import type { SessionViewFile } from "@mosoo/ag-ui-session";

export type RuntimeArtifactSummaryChange =
  | { change: "delete"; fileId: string }
  | { change: "upsert"; file: SessionViewFile }
  | null;

export interface RuntimeFileChangeInput {
  change: "delete" | "upsert";
  metadata?: Record<string, unknown>;
  path: string;
}
