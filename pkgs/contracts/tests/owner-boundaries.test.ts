import { describe, expect, test } from "bun:test";

import * as Contracts from "@mosoo/contracts";
import {
  agentKindSupportsOwnerTerminal,
  agentKindSupportsResetState,
  agentKindUsesStableRuntimeSubject,
  getAgentKindRuntimePolicy,
  getAgentKindRuntimeSubjectScope,
  listAgentKindRuntimeComparisonRows,
} from "@mosoo/contracts/agent";
import { AGENT_MANIFEST_VERSION, AGENT_PACKAGE_VERSION } from "@mosoo/contracts/agent-manifest";
import {
  parseAgentManifestInput,
  parseAgentPackageJson,
} from "@mosoo/contracts/agent-manifest-parser";
import { DriverCapability } from "@mosoo/contracts/driver-instance";
import {
  ExternalToolEffectClaim,
  ExternalToolEffectSettlement,
  ExternalToolEffectState,
  MCP_EXTERNAL_TOOL_EFFECT_SETTLEMENT_MAX_UTF8_BYTES,
  measureMcpExternalToolEffectSettlement,
} from "@mosoo/contracts/external-tool-effect";
import {
  SESSION_RESOURCE_MOUNT_DIR,
  createAccountAvatarPath,
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
import type { AccountId, FileId, SessionId } from "@mosoo/contracts/id";
import {
  createRuntimeModelIdentity,
  isCustomRuntimeModelProvider,
  parseRuntimeModelIdentity,
} from "@mosoo/contracts/models";
import {
  RUNTIME_COMMAND_MAX_UTF8_BYTES,
  RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES,
  RuntimeCommandResult,
  RuntimeCommandRecord,
  measureRuntimeCommandJson,
  parseRuntimeCommand,
} from "@mosoo/contracts/runtime-command";
import {
  AGENT_SESSION_ARCHIVED_READ_ONLY_REASON,
  AGENT_SESSION_TERMINAL_READ_ONLY_REASON,
  getAgentSessionUserLifecycleProjection,
} from "@mosoo/contracts/session";
import { DurableRunError } from "@mosoo/contracts/session-run";
import { PrimitiveRecord } from "@mosoo/contracts/validation";

const FILE_ID = "01J00000000000000000000001" as FileId;
const SESSION_ID = "01J00000000000000000000002" as SessionId;
const ACCOUNT_ID = "01J00000000000000000000003" as AccountId;

function textFieldAtJsonSize<Value>(
  targetBytes: number,
  create: (text: string) => Value,
  unit = "x",
): Value {
  const baseBytes = measureRuntimeCommandJson(create(""));
  const unitBytes = measureRuntimeCommandJson(create(unit)) - baseBytes;
  const remaining = targetBytes - baseBytes;
  const value = create(
    unit.repeat(Math.floor(remaining / unitBytes)) + "x".repeat(remaining % unitBytes),
  );

  expect(measureRuntimeCommandJson(value)).toBe(targetBytes);
  return value;
}

function mcpCommandAtSize(targetBytes: number, unit = "x") {
  return textFieldAtJsonSize(
    targetBytes,
    (argumentsJson) => ({
      argumentsJson,
      commandId: "command-1",
      kind: "mcp.execute" as const,
      requestId: "request-1",
      runId: "run-1",
      serverId: "server-1",
      toolCallId: "tool-call-1",
      toolName: "tool-1",
    }),
    unit,
  );
}

function mcpSettlementAtSize(targetBytes: number, unit: string) {
  const create = (providerReceiptJson: string) => ({
    kind: "succeeded" as const,
    providerReceiptJson,
    result: {
      outputText: "created",
      requestId: "request-1",
      serverId: "server-1",
      toolName: "tool-1",
    },
  });
  const baseBytes = measureMcpExternalToolEffectSettlement(create(""));
  const unitBytes = measureMcpExternalToolEffectSettlement(create(unit)) - baseBytes;
  const remaining = targetBytes - baseBytes;
  const settlement = create(
    unit.repeat(Math.floor(remaining / unitBytes)) + "x".repeat(remaining % unitBytes),
  );

  expect(measureMcpExternalToolEffectSettlement(settlement)).toBe(targetBytes);
  return settlement;
}

describe("contracts owner boundaries", () => {
  test("does not expose the old permission package surface", () => {
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
        persistence: "platform",
      },
      terminal: {
        target: "unavailable",
      },
    });

    expect(listAgentKindRuntimeComparisonRows()).toContainEqual({
      id: "cross_session_memory",
      label: "Cross-session memory",
      values: {
        cattle: "None; isolated Thread checkpoint",
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
        settings: {
          model_reasoning_effort: "high",
          model_verbosity: "medium",
        },
      },
    });

    expect(parsed.issues).toEqual([]);
    expect(parsed.manifest?.runtime).toEqual({
      id: "openai-runtime",
      model: "gpt-5",
      provider: "openai",
      providerOptions: {
        model_reasoning_effort: "high",
        model_verbosity: "medium",
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
        settings: { model_reasoning_effort: "high" },
      }),
    );

    expect(parsed.issues).toEqual([]);
    expect(parsed.package?.manifest.kind).toBe("cattle");
    expect(parsed.package?.manifest.runtime.providerOptions).toEqual({
      model_reasoning_effort: "high",
    });
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
        input: { attachmentIds: [""], text: "Run it." },
        kind: "input.start",
        requestId: "req_1",
        runId: "run_1",
      }),
    ).toThrow();
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

  test.each([
    ["turn.cancel", { commandId: "cmd_1", kind: "turn.cancel" }],
    [
      "input.start",
      {
        commandId: "cmd_1",
        input: { text: "Run it." },
        kind: "input.start",
        requestId: "req_1",
        runId: "run_1",
      },
    ],
    ["session.stop", { commandId: "cmd_1", kind: "session.stop", reason: "done" }],
    [
      "mcp.execute",
      {
        argumentsJson: "{}",
        commandId: "cmd_1",
        kind: "mcp.execute",
        requestId: "req_1",
        runId: "run_1",
        serverId: "server_1",
        toolCallId: "tool_call_1",
        toolName: "createIssue",
      },
    ],
    [
      "permission.resolve",
      {
        commandId: "cmd_1",
        decision: "allow_once",
        kind: "permission.resolve",
        requestId: "req_1",
        runId: "run_1",
      },
    ],
  ] as const)("keeps persisted %s commands exact", (_kind, command) => {
    expect(() => parseRuntimeCommand({ ...command, debug: true })).toThrow();
  });

  test("keeps nested command inputs and terminal payloads exact", () => {
    expect(() =>
      parseRuntimeCommand({
        commandId: "cmd_1",
        input: { debug: true, text: "Run it." },
        kind: "input.start",
        requestId: "req_1",
        runId: "run_1",
      }),
    ).toThrow();
    expect(RuntimeCommandResult.allows({ debug: true, requestId: "req_1" })).toBeFalse();
    expect(
      RuntimeCommandResult.allows({
        debug: true,
        outputText: "created",
        requestId: "req_1",
        serverId: "server_1",
        toolName: "createIssue",
      }),
    ).toBeFalse();
    expect(
      DurableRunError.allows({
        code: "driver.failed",
        debug: true,
        details: {},
        message: "failed",
        retryable: false,
      }),
    ).toBeFalse();
    expect(
      ExternalToolEffectSettlement.allows({
        debug: true,
        kind: "succeeded",
        result: {
          outputText: "created",
          requestId: "req_1",
          serverId: "server_1",
          toolName: "createIssue",
        },
      }),
    ).toBeFalse();
    expect(
      ExternalToolEffectState.allows({
        debug: true,
        effectId: "effect_1",
        kind: "succeeded",
        result: {
          outputText: "created",
          requestId: "req_1",
          serverId: "server_1",
          toolName: "createIssue",
        },
      }),
    ).toBeFalse();
    expect(
      ExternalToolEffectClaim.allows({
        attempt: 1,
        debug: true,
        effectId: "effect_1",
        idempotencyKey: "effect_1",
        kind: "claimed",
      }),
    ).toBeFalse();
    expect(
      DriverCapability.allows({
        debug: true,
        id: "mcp_execute",
        status: "supported",
        version: 1,
      }),
    ).toBeFalse();

    const commandRecord = {
      ackedAt: null,
      completedAt: null,
      driverInstanceId: "driver_1",
      error: null,
      expiresAt: null,
      id: "cmd_1",
      issuedAt: "2026-01-01T00:00:00.000Z",
      kind: "input.start" as const,
      payload: {
        commandId: "cmd_1",
        input: { text: "Run it." },
        kind: "input.start" as const,
        requestId: "req_1",
        runId: "run_1",
      },
      result: null,
      seq: 0,
      status: "queued" as const,
    };
    expect(RuntimeCommandRecord.allows({ ...commandRecord, debug: true })).toBeFalse();
    expect(
      RuntimeCommandRecord.allows({
        ...commandRecord,
        error: {
          code: "driver.failed",
          details: {},
          message: "failed",
          retryable: false,
        },
        result: { requestId: "req_1" },
        status: "completed",
      }),
    ).toBeFalse();
    expect(PrimitiveRecord.allows({ fields: Number.NaN })).toBeFalse();
    expect(
      DurableRunError.allows({
        code: "driver.failed",
        details: { durationMs: Number.POSITIVE_INFINITY },
        message: "failed",
        retryable: false,
      }),
    ).toBeFalse();
  });

  test.each(["x", "界", "\0"])(
    "bounds canonical runtime command JSON after %p UTF-8 encoding",
    (unit) => {
      const exact = mcpCommandAtSize(RUNTIME_COMMAND_MAX_UTF8_BYTES, unit);

      expect(parseRuntimeCommand(exact)).toEqual(exact);
      expect(() =>
        parseRuntimeCommand({ ...exact, argumentsJson: `${exact.argumentsJson}x` }),
      ).toThrow();
    },
  );

  test.each(["x", "界", "\0"])(
    "bounds both driver command terminal columns after %p UTF-8 encoding",
    (unit) => {
      const result = textFieldAtJsonSize(
        RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES,
        (outputText) => ({
          outputText,
          requestId: "request-1",
          serverId: "server-1",
          toolName: "tool-1",
        }),
        unit,
      );
      const error = textFieldAtJsonSize(
        RUNTIME_COMMAND_TERMINAL_PAYLOAD_MAX_UTF8_BYTES,
        (message) => ({ code: "driver.failed", details: {}, message, retryable: false }),
        unit,
      );

      expect(RuntimeCommandResult.allows(result)).toBeTrue();
      expect(
        RuntimeCommandResult.allows({ ...result, outputText: `${result.outputText}x` }),
      ).toBeFalse();
      expect(DurableRunError.allows(error)).toBeTrue();
      expect(DurableRunError.allows({ ...error, message: `${error.message}x` })).toBeFalse();
    },
  );

  test.each(["x", "界", "\0"])(
    "bounds the whole MCP settlement envelope after %p UTF-8 encoding",
    (unit) => {
      const exact = mcpSettlementAtSize(MCP_EXTERNAL_TOOL_EFFECT_SETTLEMENT_MAX_UTF8_BYTES, unit);

      expect(ExternalToolEffectSettlement.allows(exact)).toBeTrue();
      expect(
        ExternalToolEffectSettlement.allows({
          ...exact,
          providerReceiptJson: `${exact.providerReceiptJson}x`,
        }),
      ).toBeFalse();
    },
  );

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

    expect(createAccountAvatarPath(FILE_ID, " avatar.png ")).toBe(`avatar/${FILE_ID}/avatar.png`);
    expect(
      createFileObjectKey({
        id: FILE_ID,
        name: "avatar.png",
        path: `avatar/${FILE_ID}/avatar.png`,
        scope: createScope("account", ACCOUNT_ID),
      }),
    ).toBe(`account/${ACCOUNT_ID}/avatar/${FILE_ID}/avatar.png`);

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
