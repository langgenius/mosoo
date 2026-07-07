import { describe, expect, test } from "bun:test";

import {
  createAgentPackageArchiveBytes,
  parseAgentPackageArchiveBytes,
} from "@mosoo/agent-package";
import type { AgentPackage } from "@mosoo/contracts/agent-manifest";
import { AGENT_MANIFEST_VERSION, AGENT_PACKAGE_VERSION } from "@mosoo/contracts/agent-manifest";

interface StoredZipEntry {
  body: Uint8Array;
  path: string;
}

const CRC32_TABLE = createCrc32Table();
const textEncoder = new TextEncoder();

describe("agent package archive entry admission", () => {
  test("rejects unsafe original archive entry paths", () => {
    const cases = [
      { code: "package.archive.entry_absolute", path: "/manifest.json" },
      { code: "package.archive.entry_absolute", path: "C:/manifest.json" },
      { code: "package.archive.entry_empty_segment", path: "skills//demo/SKILL.md" },
      { code: "package.archive.entry_current_segment", path: "skills/./demo/SKILL.md" },
      { code: "package.archive.entry_parent_segment", path: "skills/../manifest.json" },
      { code: "package.archive.entry_control_character", path: "skills/\u0001.md" },
      { code: "package.archive.entry_reserved", path: "manifest.json/child" },
    ];

    for (const testCase of cases) {
      const parsed = parseAgentPackageArchiveBytes(
        createStoredZipArchive([
          {
            body: textToArchiveBytes(createPackageManifestJson()),
            path: "manifest.json",
          },
          { body: textToArchiveBytes("{}"), path: testCase.path },
        ]),
      );

      expect(parsed.package).toBeNull();
      expect(parsed.issues[0]?.code).toBe(testCase.code);
    }
  });

  test("rejects duplicate entries and file ancestor collisions through the archive parser", () => {
    const cases = [
      {
        code: "package.archive.entry_duplicate",
        entries: [
          { body: textToArchiveBytes("{}"), path: "manifest.json" },
          { body: textToArchiveBytes("{}"), path: "manifest.json" },
        ],
      },
      {
        code: "package.archive.entry_collision",
        entries: [
          {
            body: textToArchiveBytes(
              createPackageManifestJson({
                skills: [{ name: "Demo", path: "skills/demo/" }],
              }),
            ),
            path: "manifest.json",
          },
          {
            body: textToArchiveBytes("---\nname: Demo\n---\nUse this skill."),
            path: "skills/demo/SKILL.md",
          },
          { body: textToArchiveBytes("{}"), path: "skills" },
        ],
      },
    ] as const;

    for (const testCase of cases) {
      const parsed = parseAgentPackageArchiveBytes(createStoredZipArchive(testCase.entries));

      expect(parsed.package).toBeNull();
      expect(parsed.issues[0]?.code).toBe(testCase.code);
    }
  });

  test("rejects unsafe ZIP originals before extraction builds a path record", () => {
    const archive = createStoredZipArchive([
      { body: textToArchiveBytes("{}"), path: "manifest.json" },
      { body: textToArchiveBytes("{}"), path: "/manifest.json" },
    ]);
    const parsed = parseAgentPackageArchiveBytes(archive);

    expect(parsed.package).toBeNull();
    expect(parsed.issues[0]?.code).toBe("package.archive.entry_absolute");
  });

  test("rejects duplicate ZIP entries before extraction builds a path record", () => {
    const archive = createStoredZipArchive([
      { body: textToArchiveBytes("{}"), path: "manifest.json" },
      { body: textToArchiveBytes("{}"), path: "manifest.json" },
    ]);
    const parsed = parseAgentPackageArchiveBytes(archive);

    expect(parsed.package).toBeNull();
    expect(parsed.issues[0]?.code).toBe("package.archive.entry_duplicate");
  });

  test("rejects manifest declarations that target reserved package files", () => {
    const archive = createStoredZipArchive([
      {
        body: textToArchiveBytes(
          createPackageManifestJson({ skills: [{ name: "Reserved", path: "manifest.json" }] }),
        ),
        path: "manifest.json",
      },
      {
        body: textToArchiveBytes('{"secretNames":[],"setupScript":""}'),
        path: "environment/definition.json",
      },
    ]);
    const parsed = parseAgentPackageArchiveBytes(archive);

    expect(parsed.package).toBeNull();
    expect(parsed.issues[0]?.code).toBe("package.archive.entry_reserved");
  });

  test("rejects package assets that target reserved package files", () => {
    const agentPackage = createAgentPackageFixture({
      assets: [
        {
          contentText: "<svg></svg>",
          filename: "icon.svg",
          key: "manifest.json",
          mimeType: "image/svg+xml",
          role: "avatar",
          size: textToArchiveBytes("<svg></svg>").byteLength,
        },
      ],
    });

    expect(() => createAgentPackageArchiveBytes(agentPackage)).toThrow();
  });

  test("round-trips an admitted package archive", () => {
    const skillBytes = textToArchiveBytes("---\nname: Demo\n---\nUse this skill.");
    const agentPackage = createAgentPackageFixture({
      assets: [
        {
          contentBytes: skillBytes,
          contentText: null,
          filename: "SKILL.md",
          key: "skills/demo/SKILL.md",
          mimeType: null,
          role: "skill_file",
          size: skillBytes.byteLength,
        },
      ],
      skills: [
        {
          ownerName: null,
          skillId: "skills/demo/",
          skillName: "Demo",
          state: "active",
        },
      ],
    });

    const archiveBytes = createAgentPackageArchiveBytes(agentPackage);
    const parsed = parseAgentPackageArchiveBytes(archiveBytes);

    expect(parsed.package).not.toBeNull();
    expect(parsed.package?.assets.map((asset) => asset.key).toSorted()).toEqual([
      "skills/demo/SKILL.md",
    ]);
  });

  test("round-trips an mcp-bound package through the reserved .mcp.json sidecar", () => {
    const agentPackage = createAgentPackageFixture({
      mcpServers: [
        {
          authType: "bearer",
          credentialMode: "runtime_resolved",
          credentialScope: "app",
          enabled: true,
          iconUrl: null,
          name: "github",
          serverId: null,
          source: "app",
          url: "https://mcp.github.example/mcp",
        },
      ],
    });

    const archiveBytes = createAgentPackageArchiveBytes(agentPackage);
    const parsed = parseAgentPackageArchiveBytes(archiveBytes);

    // Before the extractor exempted `.mcp.json` from skill path admission this
    // returned package=null with package.archive.invalid, so an MCP-bound agent
    // exported as a .agent file could never be re-imported.
    expect(parsed.issues).toEqual([]);
    expect(parsed.package).not.toBeNull();
    expect(parsed.package?.manifest.mcpServers.map((server) => server.name)).toEqual(["github"]);
    expect(parsed.package?.manifest.mcpServers[0]?.url).toBe("https://mcp.github.example/mcp");
  });
});

function createAgentPackageFixture(
  input: {
    assets?: AgentPackage["assets"];
    avatarAssetKey?: string | null;
    mcpServers?: AgentPackage["manifest"]["mcpServers"];
    skills?: AgentPackage["manifest"]["skills"];
  } = {},
): AgentPackage {
  return {
    app: {
      avatarAssetKey: input.avatarAssetKey ?? null,
      description: "Test package",
      name: "Test Agent",
    },
    assets: input.assets ?? [],
    author: null,
    exportedAt: "2026-01-01T00:00:00.000Z",
    license: null,
    manifest: {
      advanced: null,
      environment: {
        environmentId: null,
        envVars: {},
        expectedName: null,
        setupScript: "",
      },
      kind: "pet",
      manifestVersion: AGENT_MANIFEST_VERSION,
      mcpServers: input.mcpServers ?? [],
      metadata: {
        description: "Test package",
        name: "Test Agent",
      },
      prompts: {
        system: "Be useful.",
      },
      runtime: {
        id: "claude-agent-sdk",
        model: "claude-sonnet-4-5",
        provider: "anthropic",
        providerOptions: {},
      },
      skills: input.skills ?? [],
      spaces: [],
    },
    packageVersion: AGENT_PACKAGE_VERSION,
    sourceAgentId: null,
    version: "1.0.0",
  };
}

function createPackageManifestJson(
  input: { avatar?: string | null; skills?: { name: string; path: string }[] } = {},
): string {
  return JSON.stringify({
    author: null,
    avatar: input.avatar ?? null,
    description: "Test package",
    environment: { ref: "environment/definition.json" },
    exportedAt: "2026-01-01T00:00:00.000Z",
    kind: "pet",
    license: null,
    manifestVersion: AGENT_MANIFEST_VERSION,
    mcpServers: [],
    model: "claude-sonnet-4-5",
    name: "Test Agent",
    packageVersion: AGENT_PACKAGE_VERSION,
    prompts: { system: "Be useful." },
    provider: "anthropic",
    runtime: "claude-agent-sdk",
    skills: input.skills ?? [],
    version: "1.0.0",
  });
}

function textToArchiveBytes(input: string): Uint8Array {
  return textEncoder.encode(input);
}

function createStoredZipArchive(entries: readonly StoredZipEntry[]): Uint8Array {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const pathBytes = textToArchiveBytes(entry.path);
    const crc = crc32(entry.body);
    const localHeader = createLocalHeader(pathBytes, entry.body, crc);
    const centralHeader = createCentralHeader(pathBytes, entry.body, crc, localOffset);

    localChunks.push(localHeader);
    centralChunks.push(centralHeader);
    localOffset += localHeader.byteLength;
  }

  const centralOffset = localOffset;
  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const endOfCentralDirectory = new Uint8Array(22);

  writeUint32LE(endOfCentralDirectory, 0, 0x06_05_4b_50);
  writeUint16LE(endOfCentralDirectory, 8, entries.length);
  writeUint16LE(endOfCentralDirectory, 10, entries.length);
  writeUint32LE(endOfCentralDirectory, 12, centralSize);
  writeUint32LE(endOfCentralDirectory, 16, centralOffset);

  return concatChunks([...localChunks, ...centralChunks, endOfCentralDirectory]);
}

function createLocalHeader(pathBytes: Uint8Array, body: Uint8Array, crc: number): Uint8Array {
  const header = new Uint8Array(30 + pathBytes.byteLength + body.byteLength);

  writeUint32LE(header, 0, 0x04_03_4b_50);
  writeUint16LE(header, 4, 20);
  writeUint32LE(header, 14, crc);
  writeUint32LE(header, 18, body.byteLength);
  writeUint32LE(header, 22, body.byteLength);
  writeUint16LE(header, 26, pathBytes.byteLength);
  header.set(pathBytes, 30);
  header.set(body, 30 + pathBytes.byteLength);

  return header;
}

function createCentralHeader(
  pathBytes: Uint8Array,
  body: Uint8Array,
  crc: number,
  localOffset: number,
): Uint8Array {
  const header = new Uint8Array(46 + pathBytes.byteLength);

  writeUint32LE(header, 0, 0x02_01_4b_50);
  writeUint16LE(header, 4, 20);
  writeUint16LE(header, 6, 20);
  writeUint32LE(header, 16, crc);
  writeUint32LE(header, 20, body.byteLength);
  writeUint32LE(header, 24, body.byteLength);
  writeUint16LE(header, 28, pathBytes.byteLength);
  writeUint32LE(header, 42, localOffset);
  header.set(pathBytes, 46);

  return header;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const totalBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const output = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;

  for (const byte of bytes) {
    const tableValue = CRC32_TABLE[(crc ^ byte) & 0xff];

    if (tableValue === undefined) {
      throw new Error("CRC table is incomplete.");
    }

    crc = (crc >>> 8) ^ tableValue;
  }

  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

function writeUint16LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}
