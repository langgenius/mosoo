import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import * as Contracts from "@mosoo/contracts";
import {
  agentKindSupportsOwnerTerminal,
  agentKindSupportsResetState,
  agentKindUsesStableRuntimeSubject,
  getAgentKindRuntimePolicy,
  getAgentKindRuntimeSubjectScope,
  listAgentKindRuntimeComparisonRows,
} from "@mosoo/contracts/agent";
import {
  AGENT_BUILDER_ASK_USER_MODE_VALUES,
  AGENT_BUILDER_CONTROL_PLANE_TOOL_ID_VALUES,
  AGENT_BUILDER_NEXT_ACTION_KIND_VALUES,
  getAgentBuilderDraftPatchSectionId,
  isAgentBuilderDraftPatchOperation,
  isAgentBuilderDraftPatchValue,
  isAgentBuilderNodeKey,
  normalizeAgentBuilderNodeKey,
  parseAgentBuilderPlannerOutput,
  resolveAgentBuilderDraftPatchFieldPath,
} from "@mosoo/contracts/agent-builder";
import { AGENT_MANIFEST_VERSION, AGENT_PACKAGE_VERSION } from "@mosoo/contracts/agent-manifest";
import {
  parseAgentManifestInput,
  parseAgentPackageJson,
} from "@mosoo/contracts/agent-manifest-parser";
import {
  SESSION_RESOURCE_MOUNT_DIR,
  createAttachmentPath,
  createDownloadDisposition,
  createFileObjectKey,
  createScope,
  createSessionFilePath,
  ensureLibraryFilePathHasExtension,
  joinPath,
  normalizeFileName,
  normalizeLibraryDirectoryPath,
  normalizeLibraryFilePath,
  toSessionResourceMaterializedPath,
} from "@mosoo/contracts/file";
import type { FileId, SessionId } from "@mosoo/contracts/id";
import {
  createRuntimeModelIdentity,
  isCustomRuntimeModelProvider,
  parseRuntimeModelIdentity,
} from "@mosoo/contracts/models";
import { parseRuntimeCommand } from "@mosoo/contracts/runtime-command";
import {
  AGENT_SESSION_ARCHIVED_READ_ONLY_REASON,
  AGENT_SESSION_TERMINAL_READ_ONLY_REASON,
  getAgentSessionUserLifecycleProjection,
} from "@mosoo/contracts/session";

const FILE_ID = "01J00000000000000000000001" as FileId;
const SESSION_ID = "01J00000000000000000000002" as SessionId;

function readFixture(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("contracts owner boundaries", () => {
  test("does not expose the old permission package surface", () => {
    const packageJson = readFixture("../package.json");
    const indexSource = readFixture("../src/index.ts");

    expect(packageJson).not.toContain('"./permission"');
    expect(indexSource).not.toContain("permission.contract");
    expect(indexSource).not.toContain("./permission/");
    expect(packageJson).not.toContain("providers.company.create");
    expect(packageJson).not.toContain("agents.acl.");
    expect(existsSync(new URL("../src/permission/permission.contract.ts", import.meta.url))).toBe(
      false,
    );
    expect("Permission" in Contracts).toBe(false);
    expect("can" in Contracts).toBe(false);
  });

  test("agent kind runtime policy owns Pet and Cattle semantics", () => {
    expect(getAgentKindRuntimeSubjectScope("pet")).toBe("agent");
    expect(getAgentKindRuntimeSubjectScope("cattle")).toBe("session");
    expect(agentKindUsesStableRuntimeSubject("pet")).toBe(true);
    expect(agentKindUsesStableRuntimeSubject("cattle")).toBe(false);
    expect(agentKindSupportsOwnerTerminal("pet")).toBe(true);
    expect(agentKindSupportsOwnerTerminal("cattle")).toBe(false);
    expect(agentKindSupportsResetState("pet")).toBe(true);
    expect(agentKindSupportsResetState("cattle")).toBe(false);

    expect(getAgentKindRuntimePolicy("pet")).toMatchObject({
      copy: {
        label: "Assistant Agent",
        tagline: "Always-on teammate",
      },
      nativeResume: {
        persistence: "platform",
      },
      terminal: {
        target: "stable_subject",
      },
    });
    expect(getAgentKindRuntimePolicy("cattle")).toMatchObject({
      copy: {
        label: "Task Agent",
        tagline: "On-demand worker",
      },
      nativeResume: {
        persistence: "volatile",
      },
      terminal: {
        target: "unavailable",
      },
    });

    expect(listAgentKindRuntimeComparisonRows()).toContainEqual({
      id: "cross_session_memory",
      label: "Cross-session memory",
      values: {
        cattle: "Only explicit session files",
        pet: "Stable sandbox continuity",
      },
    });
  });

  test("agent manifest parser owns required public manifest fields", () => {
    const invalid = parseAgentManifestInput({});

    expect(invalid.manifest).toBeNull();
    expect(invalid.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "manifest.version.unsupported",
        "manifest.metadata.name.missing",
        "manifest.kind.missing",
        "manifest.runtime.missing",
        "manifest.model.missing",
      ]),
    );

    const parsed = parseAgentManifestInput({
      kind: "pet",
      manifestVersion: AGENT_MANIFEST_VERSION,
      metadata: { name: "Ops Helper" },
      prompts: { system: "Help with operations." },
      runtime: {
        id: "openai-runtime",
        model: "gpt-5",
        provider: "openai",
        providerOptions: {
          features: {
            web_search: true,
          },
          reasoning_effort: "high",
        },
      },
    });

    expect(parsed.issues).toEqual([]);
    expect(parsed.manifest?.runtime).toEqual({
      id: "openai-runtime",
      model: "gpt-5",
      provider: "openai",
      providerOptions: {
        features: {
          web_search: true,
        },
        reasoning_effort: "high",
      },
    });
  });

  test("agent package parser rejects source authority and accepts declarative packages", () => {
    const forbidden = parseAgentPackageJson(
      JSON.stringify({
        kind: "pet",
        manifestVersion: AGENT_MANIFEST_VERSION,
        model: "gpt-5",
        name: "Ops Helper",
        packageVersion: AGENT_PACKAGE_VERSION,
        prompts: { system: "Help with operations." },
        provider: "openai",
        runtime: "openai-runtime",
        sourceOrganizationId: "01J00000000000000000000001",
      }),
    );

    expect(forbidden.package).toBeNull();
    expect(forbidden.issues[0]?.code).toBe("package.field.forbidden");

    const parsed = parseAgentPackageJson(
      JSON.stringify({
        kind: "cattle",
        manifestVersion: AGENT_MANIFEST_VERSION,
        model: "gpt-5",
        name: "Support Helper",
        packageVersion: AGENT_PACKAGE_VERSION,
        prompts: { system: "Help with support." },
        provider: "openai",
        runtime: "openai-runtime",
      }),
    );

    expect(parsed.issues).toEqual([]);
    expect(parsed.package?.manifest.kind).toBe("cattle");
  });

  test("agent builder contract owns Draft patch grammar", () => {
    expect(resolveAgentBuilderDraftPatchFieldPath("identity.name")).toBe("name");
    expect(resolveAgentBuilderDraftPatchFieldPath("assets.mcpServers")).toBe("mcpServerIds");
    expect(resolveAgentBuilderDraftPatchFieldPath("runtime.id")).toBe("runtimeId");
    expect(resolveAgentBuilderDraftPatchFieldPath("runtime.provider")).toBe("provider");
    expect(resolveAgentBuilderDraftPatchFieldPath("runtime.vendor")).toBeNull();
    expect(getAgentBuilderDraftPatchSectionId("skillIds")).toBe("integrations");
    expect(getAgentBuilderDraftPatchSectionId("prompt")).toBe("basics");
    expect(isAgentBuilderDraftPatchOperation("blocked")).toBe(false);
    expect(isAgentBuilderDraftPatchOperation("remove")).toBe(true);
    expect(isAgentBuilderDraftPatchValue(["01J00000000000000000000001"])).toBe(true);
    expect(isAgentBuilderDraftPatchValue({ value: "nope" })).toBe(false);
  });

  test("agent builder planner parser preserves visible asset binding state", () => {
    const output = {
      assistantText: "Bind the skill.",
      intentSummary: "Bind support skill.",
      mode: "draft_patch",
      nodes: [
        {
          actions: [],
          draftPatch: {
            fieldPath: "skillIds",
            resolvedReferences: [
              {
                bindingState: "not_bound",
                id: "01J00000000000000000000003",
                name: "Support Skill",
                targetType: "skill",
              },
            ],
            value: ["01J00000000000000000000003"],
          },
          kind: "draft_patch",
          nodeKey: "bind_skill",
          operation: "bind",
          requiresConfirmation: false,
          status: "pending",
          summary: "Bind support skill.",
          targetType: "draft",
        },
      ],
      plannerRunId: "01J00000000000000000000004",
      version: 1,
    };

    expect(
      parseAgentBuilderPlannerOutput(output)?.nodes[0]?.draftPatch?.resolvedReferences?.[0]
        ?.bindingState,
    ).toBe("not_bound");
    expect(
      parseAgentBuilderPlannerOutput({
        ...output,
        nodes: [
          {
            ...output.nodes[0],
            draftPatch: {
              ...output.nodes[0]?.draftPatch,
              resolvedReferences: [
                {
                  id: "01J00000000000000000000003",
                  name: "Support Skill",
                  targetType: "skill",
                },
              ],
            },
          },
        ],
      }),
    ).toBeNull();
  });

  test("agent builder contract owns lightweight control-plane grammar", () => {
    expect(AGENT_BUILDER_CONTROL_PLANE_TOOL_ID_VALUES).toEqual([
      "inspect_builder_context",
      "search_builder_assets",
      "patch_manifest_draft",
      "ask_user",
      "show_next_action",
      "create_agent",
      "apply_agent_config",
      "create_environment",
      "create_remote_mcp_server",
      "reset_preview_session",
    ]);
    expect(AGENT_BUILDER_ASK_USER_MODE_VALUES).toEqual([
      "single_select",
      "multi_select",
      "free_text",
    ]);
    expect(AGENT_BUILDER_NEXT_ACTION_KIND_VALUES).toEqual([
      "create_agent",
      "configure_environment",
      "open_preview",
      "keep_refining",
    ]);
    expect(normalizeAgentBuilderNodeKey(" tool:patch_manifest_draft ")).toBe(
      "tool:patch_manifest_draft",
    );
    expect(isAgentBuilderNodeKey("builder_agent_name")).toBe(true);
    expect(isAgentBuilderNodeKey("Set Agent name")).toBe(false);
    expect(isAgentBuilderNodeKey("设置 Agent 名称")).toBe(false);
    expect(isAgentBuilderNodeKey("/repair/item/1")).toBe(false);
    const planNode = {
      actions: [],
      kind: "draft_patch",
      nodeKey: "patch_agent_name",
      operation: "update",
      requiresConfirmation: false,
      status: "pending",
      summary: "Set name.",
      targetType: "draft",
    } as const;

    expect(
      parseAgentBuilderPlannerOutput({
        assistantText: "Ready.",
        intentSummary: "Name the draft.",
        mode: "draft_patch",
        nodes: [
          planNode,
          {
            ...planNode,
            summary: "Set description.",
          },
        ],
        plannerRunId: "planner_run_1",
        version: 1,
      }),
    ).toBeNull();
  });

  test("runtime command parser rejects unknown or malformed command grammar", () => {
    expect(
      parseRuntimeCommand({
        commandId: "cmd_1",
        input: { text: "Run it." },
        kind: "input.start",
        requestId: "req_1",
        runId: "run_1",
      }).kind,
    ).toBe("input.start");

    expect(() =>
      parseRuntimeCommand({
        commandId: "cmd_1",
        input: { text: "" },
        kind: "input.start",
        requestId: "req_1",
        runId: "run_1",
      }),
    ).toThrow();

    expect(() =>
      parseRuntimeCommand({
        commandId: "cmd_1",
        kind: "input.resume",
      }),
    ).toThrow();
  });

  test("runtime model identity admits typed provider model runtime triples", () => {
    const identity = parseRuntimeModelIdentity({
      modelId: " gpt-5 ",
      provider: {
        kind: "custom",
        providerId: " openai-compatible ",
      },
      runtimeId: " openai-runtime ",
    });

    expect(identity).toEqual(
      createRuntimeModelIdentity({
        modelId: "gpt-5",
        provider: {
          kind: "custom",
          providerId: "openai-compatible",
        },
        runtimeId: "openai-runtime",
      }),
    );
    expect(isCustomRuntimeModelProvider(identity.provider)).toBe(true);

    expect(() =>
      parseRuntimeModelIdentity({
        modelId: " ",
        provider: {
          kind: "preset",
          providerId: "openai",
        },
        runtimeId: "openai-runtime",
      }),
    ).toThrow();
  });

  test("library directory path normalization tolerates absent roots", () => {
    // A root-level listing arrives as an explicit `null` from the GraphQL
    // nullable `path` argument; it must normalize to the empty root, not throw
    // `Cannot read properties of null (reading 'trim')`.
    expect(normalizeLibraryDirectoryPath(null)).toBe("");
    expect(normalizeLibraryDirectoryPath(undefined)).toBe("");
    expect(normalizeLibraryDirectoryPath("")).toBe("");
    expect(normalizeLibraryDirectoryPath("docs/notes ")).toBe("docs/notes");
    expect(() => normalizeLibraryDirectoryPath("/docs")).toThrow();
  });

  test("file contract owns user path admission before object key projection", () => {
    expect(normalizeLibraryFilePath("docs/notes.txt ")).toBe("docs/notes.txt");
    expect(ensureLibraryFilePathHasExtension("docs/notes.txt")).toBe("docs/notes.txt");
    expect(joinPath("docs", "notes.txt")).toBe("docs/notes.txt");
    expect(createAttachmentPath(FILE_ID, " notes.txt ")).toBe(`attachment/${FILE_ID}/notes.txt`);
    expect(createSessionFilePath(FILE_ID, " notes.txt ")).toBe(
      `session-files/${FILE_ID}/notes.txt`,
    );

    for (const path of [
      "/docs/notes.txt",
      "docs/../notes.txt",
      "docs/%2f/notes.txt",
      "docs/notes.txt/",
      String.raw`docs\notes.txt`,
    ]) {
      expect(() => normalizeLibraryFilePath(path)).toThrow();
    }

    expect(() => normalizeFileName("notes\r\nx-file: bad.txt")).toThrow();
    expect(createDownloadDisposition(' "notes".txt ', "attachment")).toBe(
      'attachment; filename="notes.txt"',
    );
    expect(() => createDownloadDisposition('"', "attachment")).toThrow();

    expect(() => joinPath("docs", "nested/notes.txt")).toThrow();
    expect(() => ensureLibraryFilePathHasExtension("docs/README")).toThrow();
  });

  test("file contract rejects noncanonical object key projection records", () => {
    expect(
      createFileObjectKey({
        id: FILE_ID,
        name: "notes.txt",
        path: "docs/notes.txt",
        scope: createScope("library", null),
      }),
    ).toBe(`library/${FILE_ID}/docs/notes.txt`);

    expect(
      createFileObjectKey({
        id: FILE_ID,
        name: "notes.txt",
        path: "session-files/ignored/notes.txt",
        scope: createScope("session", SESSION_ID),
      }),
    ).toBe(`session/${SESSION_ID}/attachment/${FILE_ID}/notes.txt`);

    expect(() =>
      createFileObjectKey({
        id: FILE_ID,
        name: "notes.txt",
        path: "docs/notes.txt ",
        scope: createScope("library", null),
      }),
    ).toThrow();

    expect(() =>
      createFileObjectKey({
        id: FILE_ID,
        name: " notes.txt",
        path: "session-files/ignored/notes.txt",
        scope: createScope("session", SESSION_ID),
      }),
    ).toThrow();
  });

  test("file contract materializes only canonical session resource paths", () => {
    expect(SESSION_RESOURCE_MOUNT_DIR).toBe("session-files");
    expect(toSessionResourceMaterializedPath(`attachment/${FILE_ID}/notes.txt`)).toBe(
      `session-files/${FILE_ID}/notes.txt`,
    );
    expect(toSessionResourceMaterializedPath(`session-files/${FILE_ID}/notes.txt`)).toBe(
      `session-files/${FILE_ID}/notes.txt`,
    );

    for (const path of [
      `/attachment/${FILE_ID}/notes.txt`,
      `attachment/${FILE_ID}/notes.txt/`,
      `archive/${FILE_ID}/notes.txt`,
      `attachment/${FILE_ID}/nested/notes.txt`,
      "attachment/not-a-file-id/notes.txt",
      `attachment/${FILE_ID.toLowerCase()}/notes.txt`,
      `attachment/${FILE_ID}/ notes.txt`,
      `attachment/${FILE_ID}/notes\r.txt`,
    ] as const) {
      expect(() => toSessionResourceMaterializedPath(path)).toThrow();
    }
  });

  test("session contract owns user lifecycle projection from engineering state", () => {
    expect(
      getAgentSessionUserLifecycleProjection({
        archivedAt: null,
        status: "RESCHEDULING",
      }),
    ).toEqual({
      readOnly: false,
      recoverability: {
        reason: null,
        status: "resumable",
      },
      state: "alive",
      terminal: false,
    });

    expect(
      getAgentSessionUserLifecycleProjection({
        archivedAt: "2026-06-01T00:00:00.000Z",
        status: "IDLE",
      }),
    ).toEqual({
      readOnly: true,
      recoverability: {
        reason: AGENT_SESSION_ARCHIVED_READ_ONLY_REASON,
        status: "read_only",
      },
      state: "asleep",
      terminal: false,
    });

    expect(
      getAgentSessionUserLifecycleProjection({
        archivedAt: "2026-06-01T00:00:00.000Z",
        status: "TERMINATED",
      }),
    ).toEqual({
      readOnly: true,
      recoverability: {
        reason: AGENT_SESSION_TERMINAL_READ_ONLY_REASON,
        status: "not_recoverable",
      },
      state: "buried",
      terminal: true,
    });
  });
});
