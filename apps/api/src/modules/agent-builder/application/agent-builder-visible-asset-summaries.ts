import type {
  AgentBuilderSelectedSpaceFilesSummary,
  AgentBuilderVisibleChannelSummary,
  AgentBuilderVisibleEnvironmentSummary,
  AgentBuilderVisibleMcpServerSummary,
  AgentBuilderVisibleSkillSummary,
  AgentBuilderVisibleSpaceSummary,
} from "@mosoo/contracts/agent-builder";
import { fileRecordsTable, spaceDirectoriesTable } from "@mosoo/db";
import { parsePlatformId } from "@mosoo/id";
import type { EnvironmentId, McpServerId, SkillId, SpaceId } from "@mosoo/id";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { ApiBindings } from "../../../platform/cloudflare/worker-types";
import { getAppDatabase } from "../../../platform/db/drizzle";
import { listOrganizationEnvironments } from "../../environments/application/environment-queries";
import { getMcpRegistry } from "../../mcp/application/mcp-registry.service";
import { listOrganizationSkills } from "../../skills/application/skill-query.service";
import { listVisibleSpaces } from "../../spaces/application/space.service";
import {
  compareByNameThenId,
  normalizeUnique,
  readUrlHost,
  toBindingState,
  withHash,
} from "./agent-builder-visible-asset-model";
import type {
  AgentBuilderVisibleAssetProviderInput,
  AgentBuilderVisibleAssetSummaryCollections,
  DraftSpaceBinding,
} from "./agent-builder-visible-assets.types";

const SPACE_FILE_ENTRY_LIMIT = 20;

type VisibleSpaces = Awaited<ReturnType<typeof listVisibleSpaces>>;

function summarizeSkills(
  input: {
    boundSkillIds: ReadonlySet<SkillId>;
  },
  skills: Awaited<ReturnType<typeof listOrganizationSkills>>,
): AgentBuilderVisibleSkillSummary[] {
  return skills
    .map((skill) =>
      withHash({
        bindingState: toBindingState(skill.id, input.boundSkillIds),
        description: skill.description,
        id: skill.id,
        name: skill.name,
        ownerName: skill.ownerName,
        snapshotId: skill.snapshotId,
        sourceKind: skill.sourceKind,
        updatedAt: skill.updatedAt,
      }),
    )
    .toSorted((left, right) => compareByNameThenId(left, right));
}

function summarizeMcpServers(
  input: {
    boundMcpServerIds: ReadonlySet<McpServerId>;
    bindingRepresented: boolean;
  },
  registry: Awaited<ReturnType<typeof getMcpRegistry>>,
): AgentBuilderVisibleMcpServerSummary[] {
  return [...registry.personal, ...registry.organizationShared]
    .map((server) =>
      withHash({
        authType: server.authType,
        authorizationState: server.authorizationState,
        bindingState: toBindingState(server.id, input.boundMcpServerIds, input.bindingRepresented),
        credentialScope: server.credentialScope,
        credentialStatus: server.credentialStatus,
        description: server.description,
        enabled: server.enabled,
        id: server.id,
        name: server.name,
        source: server.source,
        updatedAt: server.updatedAt,
        urlHost: readUrlHost(server.url),
      }),
    )
    .toSorted((left, right) => compareByNameThenId(left, right));
}

function summarizeEnvironments(
  input: {
    environmentId: EnvironmentId | null;
  },
  environments: Awaited<ReturnType<typeof listOrganizationEnvironments>>,
): AgentBuilderVisibleEnvironmentSummary[] {
  return environments
    .map((environment) =>
      withHash({
        allowMcpServers: environment.allowMcpServers,
        allowPackageManagers: environment.allowPackageManagers,
        bindingState:
          input.environmentId !== null && input.environmentId === environment.id
            ? "bound"
            : "not_bound",
        description: environment.description,
        envVarKeys: environment.envVars.map((envVar) => envVar.key).toSorted(),
        id: environment.id,
        isBuiltIn: environment.isBuiltIn,
        isDefault: environment.isDefault,
        name: environment.name,
        networkPolicy: environment.networkPolicy,
        packageManagers: normalizeUnique(
          environment.packages.map((packageSpec) => packageSpec.manager),
        ),
        setupScriptConfigured: environment.setupScript.trim().length > 0,
        updatedAt: environment.updatedAt,
      }),
    )
    .toSorted((left, right) => compareByNameThenId(left, right));
}

function summarizeSpaces(
  input: {
    boundSpaceIds: ReadonlySet<SpaceId>;
  },
  spaces: Awaited<ReturnType<typeof listVisibleSpaces>>,
): AgentBuilderVisibleSpaceSummary[] {
  return spaces
    .map((space) =>
      withHash({
        bindingState: toBindingState(space.id, input.boundSpaceIds),
        id: space.id,
        name: space.name,
        role: space.role,
        visibility: space.visibility,
      }),
    )
    .toSorted((left, right) => compareByNameThenId(left, right));
}

async function summarizeSelectedSpaceFiles(input: {
  bindings: ApiBindings;
  draftSpaces: DraftSpaceBinding[];
  visibleSpaces: VisibleSpaces;
}): Promise<AgentBuilderSelectedSpaceFilesSummary[]> {
  const visibleSpaceIds = new Set(input.visibleSpaces.map((space) => space.id));
  const selectedSpaceIds = normalizeUnique(input.draftSpaces.map((space) => space.id)).filter(
    (spaceId) => visibleSpaceIds.has(spaceId),
  );
  const database = getAppDatabase(input.bindings.DB);
  const [directoryRows, fileRows] =
    selectedSpaceIds.length === 0
      ? [[], []]
      : await Promise.all([
          database
            .select({
              path: spaceDirectoriesTable.path,
              spaceId: spaceDirectoriesTable.spaceId,
            })
            .from(spaceDirectoriesTable)
            .where(
              and(
                inArray(spaceDirectoriesTable.spaceId, selectedSpaceIds),
                eq(spaceDirectoriesTable.parentPath, ""),
                sql`${spaceDirectoriesTable.name} NOT LIKE '.%'`,
              ),
            )
            .orderBy(asc(sql<string>`lower(${spaceDirectoriesTable.name})`))
            .all(),
          database
            .select({
              mimeType: fileRecordsTable.mimeType,
              path: fileRecordsTable.path,
              scopeId: fileRecordsTable.scopeId,
              size: fileRecordsTable.size,
            })
            .from(fileRecordsTable)
            .where(
              and(
                eq(fileRecordsTable.scopeKind, "space"),
                inArray(fileRecordsTable.scopeId, selectedSpaceIds),
                eq(fileRecordsTable.parentPath, ""),
                eq(fileRecordsTable.status, "ready"),
                sql`${fileRecordsTable.name} NOT LIKE '.%'`,
              ),
            )
            .orderBy(asc(sql<string>`lower(${fileRecordsTable.name})`))
            .all(),
        ]);

  const directoriesBySpaceId = new Map<SpaceId, string[]>();
  const filesBySpaceId = new Map<
    SpaceId,
    Array<{
      key: string;
      mimeType: string | null;
      size: number;
    }>
  >();

  for (const row of directoryRows) {
    const directories = directoriesBySpaceId.get(row.spaceId) ?? [];
    directories.push(`${row.path}/`);
    directoriesBySpaceId.set(row.spaceId, directories);
  }

  for (const row of fileRows) {
    const spaceId = parsePlatformId<SpaceId>(row.scopeId, "visible space file scope ID");
    const files = filesBySpaceId.get(spaceId) ?? [];
    files.push({
      key: row.path,
      mimeType: row.mimeType,
      size: row.size,
    });
    filesBySpaceId.set(spaceId, files);
  }

  return input.draftSpaces
    .map((space) => {
      if (!visibleSpaceIds.has(space.id)) {
        return withHash({
          bindingState: "bound" as const,
          directories: [],
          directoryCount: 0,
          files: [],
          fileCount: 0,
          id: space.id,
          listingState: "unavailable" as const,
          name: space.name,
          unavailableReason: "Selected Space is not visible to the current viewer.",
        });
      }

      const directories = (directoriesBySpaceId.get(space.id) ?? []).toSorted();
      const files = (filesBySpaceId.get(space.id) ?? []).toSorted((left, right) =>
        left.key.localeCompare(right.key),
      );

      return withHash({
        bindingState: "bound" as const,
        directories: directories.slice(0, SPACE_FILE_ENTRY_LIMIT),
        directoryCount: directories.length,
        files: files.slice(0, SPACE_FILE_ENTRY_LIMIT),
        fileCount: files.length,
        id: space.id,
        listingState: "available" as const,
        name: space.name,
        unavailableReason: null,
      });
    })
    .toSorted((left, right) => compareByNameThenId(left, right));
}

function summarizeChannels(): AgentBuilderVisibleChannelSummary[] {
  return [];
}

export async function collectAgentBuilderVisibleAssetSummaries(
  input: AgentBuilderVisibleAssetProviderInput,
): Promise<AgentBuilderVisibleAssetSummaryCollections> {
  const [channels, environments, mcpServers, skills, visibleSpaces] = await Promise.all([
    Promise.resolve(summarizeChannels()),
    listOrganizationEnvironments(input.bindings, input.viewer, input.organizationId).then(
      (records) => summarizeEnvironments({ environmentId: input.draft.environmentId }, records),
    ),
    getMcpRegistry(input.bindings.DB, input.viewer, input.organizationId).then((registry) =>
      summarizeMcpServers(
        {
          bindingRepresented: input.draft.mcpServersRepresented,
          boundMcpServerIds: input.boundMcpServerIds,
        },
        registry,
      ),
    ),
    listOrganizationSkills(input.bindings.DB, input.viewer, input.organizationId).then((records) =>
      summarizeSkills({ boundSkillIds: input.boundSkillIds }, records),
    ),
    listVisibleSpaces(input.bindings.DB, input.viewer, input.organizationId),
  ]);
  const selectedSpaceFiles = await summarizeSelectedSpaceFiles({
    bindings: input.bindings,
    draftSpaces: input.draft.spaces,
    visibleSpaces,
  });
  const spaces = summarizeSpaces({ boundSpaceIds: input.boundSpaceIds }, visibleSpaces);

  return {
    channels,
    environments,
    mcpServers,
    selectedSpaceFiles,
    skills,
    spaces,
  };
}
