import type { OrganizationId, SkillId } from "@mosoo/contracts/id";
import type {
  CreateSkillForkInput,
  ShareSkillWithOrganizationInput,
  ShareSkillWithUserInput,
  SkillDetail,
  SkillInspectResult,
  SkillShareTarget,
  SkillSummary,
  UnshareSkillTargetInput,
} from "@mosoo/contracts/skill";

import { graphql } from "@/gql";
import type {
  SkillDetailFieldsFragment,
  SkillShareTargetFieldsFragment,
  SkillSummaryFieldsFragment,
} from "@/gql/graphql";
import { requestGraphQL } from "@/platform/http/graphql-client";
import { apiFetch } from "@/platform/http/public-api";
import { toAccountId, toOrganizationId, toSkillId, toSkillSnapshotId } from "@/routes/typed-id";

const SKILL_SUMMARY_FIELDS = graphql(/* GraphQL */ `
  fragment SkillSummaryFields on SkillSummary {
    author
    autoEnabled
    createdAt
    description
    forkOrigin {
      name
      ownerName
      skillId
    }
    id
    name
    ownerId
    ownerName
    role
    snapshotId
    sourceKind
    updatedAt
    organizationId
  }
`);

const SKILL_SHARE_TARGET_FIELDS = graphql(/* GraphQL */ `
  fragment SkillShareTargetFields on SkillShareTarget {
    createdAt
    email
    id
    kind
    name
  }
`);

const SKILL_DETAIL_FIELDS = graphql(/* GraphQL */ `
  fragment SkillDetailFields on SkillDetail {
    author
    autoEnabled
    createdAt
    description
    forkOrigin {
      name
      ownerName
      skillId
    }
    id
    name
    ownerId
    ownerName
    role
    snapshotId
    sourceKind
    updatedAt
    organizationId
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
    shareTargets {
      ...SkillShareTargetFields
    }
  }
`);

const retainGraphQLFragments = (documents: readonly unknown[]): number => documents.length;

retainGraphQLFragments([SKILL_DETAIL_FIELDS, SKILL_SHARE_TARGET_FIELDS, SKILL_SUMMARY_FIELDS]);

function toSkillShareTarget(target: SkillShareTargetFieldsFragment): SkillShareTarget {
  return {
    ...target,
    id: target.kind === "user" ? toAccountId(target.id) : toOrganizationId(target.id),
  };
}

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
    organizationId: toOrganizationId(skill.organizationId),
    ownerId: toAccountId(skill.ownerId),
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
    shareTargets: skill.shareTargets.map(toSkillShareTarget),
  };
}

const SKILL_DETAIL_QUERY = graphql(/* GraphQL */ `
  query SkillDetail($skillId: ULID!) {
    skillDetail(skillId: $skillId) {
      ...SkillDetailFields
    }
  }
`);

const ORGANIZATION_SKILLS_QUERY = graphql(/* GraphQL */ `
  query OrganizationSkills($organizationId: ULID!) {
    organizationSkillList(organizationId: $organizationId) {
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
  mutation DeleteOwnedSkill($skillId: ULID!) {
    deleteOwnedSkill(skillId: $skillId) {
      ok
    }
  }
`);

const SHARE_WITH_USER_MUTATION = graphql(/* GraphQL */ `
  mutation ShareSkillWithUser($input: ShareSkillWithUserInput!) {
    shareSkillWithUser(input: $input) {
      ...SkillShareTargetFields
    }
  }
`);

const SHARE_WITH_ORGANIZATION_MUTATION = graphql(/* GraphQL */ `
  mutation ShareSkillWithOrganization($input: ShareSkillWithOrganizationInput!) {
    shareSkillWithOrganization(input: $input) {
      ...SkillShareTargetFields
    }
  }
`);

const UNSHARE_TARGET_MUTATION = graphql(/* GraphQL */ `
  mutation UnshareSkillTarget($input: UnshareSkillTargetInput!) {
    unshareSkillTarget(input: $input) {
      ok
    }
  }
`);

export async function listOrganizationSkills(
  organizationId: OrganizationId,
): Promise<SkillSummary[]> {
  const payload = await requestGraphQL(ORGANIZATION_SKILLS_QUERY, { organizationId });

  return payload.organizationSkillList.map(toSkillSummary);
}

export async function getSkillDetail(skillId: SkillId): Promise<SkillDetail> {
  const payload = await requestGraphQL(SKILL_DETAIL_QUERY, { skillId });

  return toSkillDetail(payload.skillDetail);
}

export async function createSkillFork(input: CreateSkillForkInput): Promise<SkillSummary> {
  const payload = await requestGraphQL(CREATE_FORK_MUTATION, { input });

  return toSkillSummary(payload.createSkillFork);
}

export async function deleteOwnedSkill(skillId: SkillId): Promise<void> {
  await requestGraphQL(DELETE_OWNED_SKILL_MUTATION, { skillId });
}

export async function shareSkillWithUser(
  input: ShareSkillWithUserInput,
): Promise<SkillShareTarget> {
  const payload = await requestGraphQL(SHARE_WITH_USER_MUTATION, { input });

  return toSkillShareTarget(payload.shareSkillWithUser);
}

export async function shareSkillWithOrganization(
  input: ShareSkillWithOrganizationInput,
): Promise<SkillShareTarget> {
  const payload = await requestGraphQL(SHARE_WITH_ORGANIZATION_MUTATION, { input });

  return toSkillShareTarget(payload.shareSkillWithOrganization);
}

export async function unshareSkillTarget(input: UnshareSkillTargetInput): Promise<void> {
  await requestGraphQL(UNSHARE_TARGET_MUTATION, { input });
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
  organizationId: OrganizationId;
}): Promise<SkillSummary> {
  const form = new FormData();
  form.append("organizationId", input.organizationId);

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

export async function fetchSkillSource(skillId: SkillId): Promise<string> {
  const response = await apiFetch(`/skill/${encodeURIComponent(skillId)}/source`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Source fetch failed: ${response.status}`);
  }

  return response.text();
}

export function skillPackageUrl(skillId: SkillId): string {
  return `/api/skill/${encodeURIComponent(skillId)}/package`;
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
