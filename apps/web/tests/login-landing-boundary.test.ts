import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Login landing boundary", () => {
  test("keeps Invoke copy aligned with exported App reuse and Agent-owned delivery", () => {
    const landingSource = readSource("../src/routes/login/landing/landing-below-fold.tsx");
    const invokeSource = readSource("../src/routes/login/landing/invoke-section.tsx");

    expect(landingSource).toContain("InvokeSection");
    expect(invokeSource).toContain("Build one App.");
    expect(invokeSource).toContain("Invoke its agents anywhere.");
    expect(invokeSource).toContain("Run exported Skill.md");
    expect(invokeSource).toContain("Reuse as Skill.md");
    expect(invokeSource).toContain("Export the App to one Skill.md");
    expect(invokeSource).toContain("Export the App for Skill.md reuse");
    expect(invokeSource).toContain("Every App-local Agent gets a typed HTTP endpoint.");
    expect(invokeSource).toContain("Live in your channels");
    expect(invokeSource).toContain("Your users talk to the agent without leaving chat.");

    expect(invokeSource.toLowerCase()).not.toContain("published agent");
    expect(invokeSource).not.toContain("Run an agent skill");
    expect(invokeSource).not.toContain("Publish once.");
    expect(invokeSource).not.toContain("Call it anywhere.");
    expect(invokeSource).not.toContain("same agent, every surface");
  });
});
