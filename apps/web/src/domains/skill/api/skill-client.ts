import type { ProjectId, SkillId } from "@mosoo/contracts/id";
import type {
  CreateSkillForkInput,
  InstallSkillsShSkillInput,
  SkillDetail,
  SkillInspectResult,
  SkillSummary,
  SkillsShCatalogResult,
  SkillsShCatalogView,
} from "@mosoo/contracts/skill";

import { graphql } from "@/gql";
import type { SkillDetailFieldsFragment, SkillSummaryFieldsFragment } from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { apiFetch } from "@/platform/http/public-api";
import { toAccountId, toProjectId, toSkillId, toSkillSnapshotId } from "@/routes/typed-id";

const SKILL_SUMMARY_FIELDS = graphql(/* GraphQL */ `
  fragment SkillSummaryFields on SkillSummary {
    author
    createdAt
    description
    fileCount
    forkOrigin {
      name
      ownerName
      skillId
    }
    id
    name
    ownerId
    ownerName
    projectId
    snapshotId
    sourceKind
    updatedAt
  }
`);

const SKILL_DETAIL_FIELDS = graphql(/* GraphQL */ `
  fragment SkillDetailFields on SkillDetail {
    author
    createdAt
    description
    fileCount
    forkOrigin {
      name
      ownerName
      skillId
    }
    id
    name
    ownerId
    ownerName
    projectId
    snapshotId
    sourceKind
    updatedAt
    currentSnapshot {
      archiveFormat
      author
      blobKey
      blobSha256
      blobSize
      compression
      createdAt
      description
      id
      name
      skillMarkdownPath
      uncompressedSize
      version
    }
    entries {
      entryKind
      isExecutable
      mimeType
      path
      sha256
      size
    }
  }
`);

const retainGraphQLFragments = (documents: readonly unknown[]): number => documents.length;

retainGraphQLFragments([SKILL_DETAIL_FIELDS, SKILL_SUMMARY_FIELDS]);

function toSkillSummary(skill: SkillSummaryFieldsFragment): SkillSummary {
  return {
    ...skill,
    forkOrigin:
      skill.forkOrigin === null
        ? null
        : {
            ...skill.forkOrigin,
            skillId: toSkillId(skill.forkOrigin.skillId),
          },
    id: toSkillId(skill.id),
    ownerId: toAccountId(skill.ownerId),
    projectId: toProjectId(skill.projectId),
    snapshotId: toSkillSnapshotId(skill.snapshotId),
  };
}

function toSkillDetail(skill: SkillDetailFieldsFragment): SkillDetail {
  return {
    ...toSkillSummary(skill),
    currentSnapshot: {
      ...skill.currentSnapshot,
      id: toSkillSnapshotId(skill.currentSnapshot.id),
    },
    entries: skill.entries,
  };
}

const SKILL_DETAIL_QUERY = graphql(/* GraphQL */ `
  query SkillDetail($projectId: ULID!, $skillId: ULID!) {
    skillDetail(projectId: $projectId, skillId: $skillId) {
      ...SkillDetailFields
    }
  }
`);

const PROJECT_SKILLS_QUERY = graphql(/* GraphQL */ `
  query ProjectSkills($projectId: ULID!) {
    projectSkillList(projectId: $projectId) {
      ...SkillSummaryFields
    }
  }
`);

const CREATE_FORK_MUTATION = graphql(/* GraphQL */ `
  mutation CreateSkillFork($input: CreateSkillForkInput!) {
    createSkillFork(input: $input) {
      ...SkillSummaryFields
    }
  }
`);

const DELETE_OWNED_SKILL_MUTATION = graphql(/* GraphQL */ `
  mutation DeleteOwnedSkill($projectId: ULID!, $skillId: ULID!) {
    deleteOwnedSkill(projectId: $projectId, skillId: $skillId) {
      ok
    }
  }
`);

export async function listProjectSkills(projectId: ProjectId): Promise<SkillSummary[]> {
  const payload = await requestGraphQL(PROJECT_SKILLS_QUERY, { projectId });

  return payload.projectSkillList.map(toSkillSummary);
}

export async function getSkillDetail(projectId: ProjectId, skillId: SkillId): Promise<SkillDetail> {
  const payload = await requestGraphQL(SKILL_DETAIL_QUERY, { projectId, skillId });

  return toSkillDetail(payload.skillDetail);
}

export async function createSkillFork(input: CreateSkillForkInput): Promise<SkillSummary> {
  const payload = await requestGraphQL(CREATE_FORK_MUTATION, { input });

  return toSkillSummary(payload.createSkillFork);
}

export async function deleteOwnedSkill(projectId: ProjectId, skillId: SkillId): Promise<void> {
  await requestGraphQL(DELETE_OWNED_SKILL_MUTATION, { projectId, skillId });
}

export async function inspectSkillUpload(input: {
  file?: File;
  githubUrl?: string;
}): Promise<SkillInspectResult> {
  const form = new FormData();

  if (input.file !== undefined) {
    form.append("file", input.file, input.file.name);
  }

  if (input.githubUrl !== undefined && input.githubUrl.length > 0) {
    form.append("githubUrl", input.githubUrl);
  }

  const response = await apiFetch("/skill/inspect", {
    body: form,
    credentials: "include",
    method: "POST",
  });

  if (!response.ok) {
    const body = await safeJson(response);
    throw new Error(body?.error ?? `Inspect failed: ${response.status}`);
  }

  const body: unknown = await response.json();
  return body as SkillInspectResult;
}

export async function publishSkillPackage(input: {
  file?: File;
  githubUrl?: string;
  skillId?: SkillId;
  projectId: ProjectId;
}): Promise<SkillSummary> {
  const form = new FormData();
  form.append("projectId", input.projectId);

  if (input.skillId !== undefined && input.skillId.length > 0) {
    form.append("skillId", input.skillId);
  }

  if (input.file !== undefined) {
    form.append("file", input.file, input.file.name);
  }

  if (input.githubUrl !== undefined && input.githubUrl.length > 0) {
    form.append("githubUrl", input.githubUrl);
  }

  const response = await apiFetch("/skill/package", {
    body: form,
    credentials: "include",
    method: "POST",
  });

  if (!response.ok) {
    const body = await safeJson(response);
    throw new Error(body?.error ?? `Publish failed: ${response.status}`);
  }

  const body: unknown = await response.json();
  return body as SkillSummary;
}

export async function listSkillsShCatalog(input: {
  availableOnly: boolean;
  page: number;
  perPage: number;
  query: string;
  view: SkillsShCatalogView;
}): Promise<SkillsShCatalogResult> {
  const params = new URLSearchParams({
    page: String(input.page),
    perPage: String(input.perPage),
    view: input.view,
  });
  params.set("availableOnly", String(input.availableOnly));
  const query = input.query.trim();

  if (query.length > 0) {
    params.set("q", query);
  }

  const response = await apiFetch(`/skill/skills-sh/catalog?${params.toString()}`, {
    credentials: "include",
  });

  if (!response.ok) {
    const body = await safeJson(response);
    throw new Error(body?.error ?? `skills.sh catalog failed: ${response.status}`);
  }

  const body: unknown = await response.json();
  return body as SkillsShCatalogResult;
}

export async function installSkillsShSkill(
  input: InstallSkillsShSkillInput,
): Promise<SkillSummary> {
  const response = await apiFetch("/skill/skills-sh/install", {
    body: JSON.stringify(input),
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const body = await safeJson(response);
    throw new Error(body?.error ?? `skills.sh install failed: ${response.status}`);
  }

  const body: unknown = await response.json();
  return body as SkillSummary;
}

export async function fetchSkillSource(projectId: ProjectId, skillId: SkillId): Promise<string> {
  const response = await apiFetch(
    `/skill/${encodeURIComponent(skillId)}/source?projectId=${encodeURIComponent(projectId)}`,
    {
      credentials: "include",
    },
  );

  if (!response.ok) {
    throw new Error(`Source fetch failed: ${response.status}`);
  }

  return response.text();
}

export function skillPackageUrl(projectId: ProjectId, skillId: SkillId): string {
  return `/api/skill/${encodeURIComponent(skillId)}/package?projectId=${encodeURIComponent(projectId)}`;
}

async function safeJson(response: Response): Promise<{ error?: string } | null> {
  try {
    const body: unknown = await response.json();
    return parseErrorBody(body);
  } catch {
    return null;
  }
}

function parseErrorBody(value: unknown): { error?: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const error = "error" in value ? value.error : undefined;
  return typeof error === "string" ? { error } : {};
}
