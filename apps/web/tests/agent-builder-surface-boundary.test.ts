import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSurfaceSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function expectRemoteMcpSecureUiWiring(source: string): void {
  expect(source).toContain("AgentBuilderRemoteMcpSecureDialog");
  expect(source).toContain("onCreateRemoteMcpServer");
  expect(source).toContain("setCreateRemoteMcpOpen(true)");
  expect(source).toContain("createCreatedMcpServerBuilderPatch");
}

function expectBuilderPreviewAndChannelBoundary(source: string): void {
  expect(source).toContain('builderActions.onAction("open_preview")');
  expect(source).not.toContain("showChannels={false}");
}

describe("Agent Builder surface boundary", () => {
  test("draft and live Builder surfaces both wire remote MCP secure UI through control-plane results", () => {
    expectRemoteMcpSecureUiWiring(
      readSurfaceSource("../src/routes/agent/lifecycle/lifecycle-shell.tsx"),
    );
    expectRemoteMcpSecureUiWiring(readSurfaceSource("../src/routes/agent/components/dev-mode.tsx"));
  });

  test("draft and live Builder surfaces open Preview through control-plane without hiding manual Channels", () => {
    expectBuilderPreviewAndChannelBoundary(
      readSurfaceSource("../src/routes/agent/lifecycle/lifecycle-shell.tsx"),
    );
    expectBuilderPreviewAndChannelBoundary(
      readSurfaceSource("../src/routes/agent/components/dev-mode.tsx"),
    );
  });

  test("Builder Preview keeps manual Channel setup outside Builder planner control", () => {
    const source = readSurfaceSource("../src/routes/agent/components/preview-mode.tsx");

    expect(source).toContain("ChannelsConfigDialog");
    expect(source).toContain("onChannelClick");
    expect(source).not.toContain("showChannels={false}");
    expect(source).not.toContain("showChannelSetup={false}");
  });

  test("Builder auto-applied patches use the normal runtime operation save path", () => {
    expect(readSurfaceSource("../src/routes/agent/components/editor/use-model.ts")).toContain(
      "persistDraft(result.draft, { runRuntimeOperations: true })",
    );
  });
});
