import type { SandboxStatus } from "@mosoo/contracts/sandbox";
import type { SessionStatus } from "@mosoo/contracts/session";

export type AgentFileEntryKind = "directory" | "file" | "space_mount" | "symlink";
export type AgentFilePersistence = "persistent" | "temporary";
export type AgentFilePreview = "binary" | "empty" | "large_text" | "text";
export type AgentFileSandboxStatus = SandboxStatus | "missing" | "unsupported";

export interface AgentFileSessionNode {
  active: boolean;
  id: string;
  status: SessionStatus;
  title: string | null;
  updatedAt: string;
}

export interface AgentFileSpaceMountNode {
  path: string;
  spaceId: string;
  spaceName: string;
  url: string;
}

interface AgentFileEntryData {
  kind: AgentFileEntryKind;
  mimeType: string | null;
  name: string;
  path: string;
  persistence: AgentFilePersistence;
  preview: AgentFilePreview;
  sizeBytes: number;
}

export interface AgentFileEntry extends AgentFileEntryData {
  session: AgentFileSessionNode | null;
  space: AgentFileSpaceMountNode | null;
}

export interface AgentFileTreeListingEntry extends AgentFileEntryData {
  session?: AgentFileSessionNode | null;
  space?: AgentFileSpaceMountNode | null;
}

export interface AgentFileTree {
  agentId: string;
  entries: AgentFileEntry[];
  lastError: string | null;
  path: string;
  sandboxId: string | null;
  sandboxStatus: AgentFileSandboxStatus;
  totalCount: number;
  truncated: boolean;
}

export interface AgentFileContent {
  agentId: string;
  content: string | null;
  mimeType: string;
  name: string;
  path: string;
  preview: AgentFilePreview;
  sandboxId: string;
  sizeBytes: number;
}

export interface AgentFileDownload {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}

export interface ListingParseResult {
  entries: AgentFileTreeListingEntry[];
  totalCount: number;
  truncated: boolean;
}
