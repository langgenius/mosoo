import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("native deliverable boundary", () => {
  test("publish success modal carries the export CTA and conformance line", () => {
    const source = readSource("../src/routes/agent/lifecycle/publish-success-modal.tsx");

    // The App-level deliverable block and its export CTA are the pinned surfaces.
    expect(source).toContain('data-testid="publish-native-deliverable"');
    expect(source).toContain('data-testid="publish-export-native-repo"');
    expect(source).toContain("Export deployable repo (.zip)");

    // The CTA drives the native-repo export mutation, then the file download.
    expect(source).toContain("exportAgentNativeRepo(toAgentId(agent.id))");
    expect(source).toContain("createFileDownload(nativeRepo.fileId)");

    // The conformance line reads as a repo-term fragment with a middle dot.
    expect(source).toContain("Same artifact");
    expect(source).toContain("mosoo deploy");
    expect(source).toContain("consumes · validates");

    // The existing quartet stays — the deliverable block is additive.
    expect(source).toContain("Try in Mosoo");
    expect(source).toContain("<AgentApiAccessPanel");
  });

  test("versions tab renders the source commit sha as commit + short sha", () => {
    const source = readSource("../src/routes/agent/components/versions-tab.tsx");

    expect(source).toContain('data-testid="version-commit-sha"');
    expect(source).toContain("version.sourceCommitSha");
    expect(source).toContain("commit ");
    expect(source).toContain("version.sourceCommitSha.slice(0, 7)");
  });
});
