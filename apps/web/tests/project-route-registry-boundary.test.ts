import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Project route registry boundary", () => {
  test("uses Project Overview as the protected console root", () => {
    const source = readSource("../src/app/route-registry.tsx");

    expect(source).toContain("ProjectOverviewPage");
    expect(source).toContain('path: "/"');
    expect(source).toContain("protectedRoute(<ProjectOverview />)");
    expect(source).not.toContain('protectedRoute(<Navigate to="/agent" replace />), path: "/"');
  });

  test("does not keep public Members or invite/join aliases", () => {
    const source = readSource("../src/app/route-registry.tsx");

    expect(source).not.toContain('path: "/members"');
    expect(source).not.toContain('path: "members"');
    expect(source).not.toContain('path: "/join/:organizationId"');
  });

  test("does not expose the old Organization Provider demo route", () => {
    const source = readSource("../src/app/route-registry.tsx");

    expect(source).not.toContain("ProviderDemo");
    expect(source).not.toContain("provider-demo.route");
    expect(source).not.toContain('path: "/demo/provider"');
    expect(source).not.toContain('path: "system-agent"');
  });
});
