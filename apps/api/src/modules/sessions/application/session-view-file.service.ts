import type { SessionViewFile } from "@mosoo/ag-ui-session";

import { toIsoString } from "../../../time";

export interface SessionArtifactFileRow {
  created_at: number;
  id: string;
  mime_type: string | null;
  name: string;
  size: number;
}

export function toSessionArtifactViewFile(row: SessionArtifactFileRow): SessionViewFile {
  return {
    committed: true,
    createdAt: toIsoString(row.created_at),
    id: row.id,
    kind: "artifact",
    mimeType: row.mime_type,
    name: row.name,
    size: row.size,
  };
}
