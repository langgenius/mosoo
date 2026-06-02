import { isRecord } from "./agent-manifest-parser-internals.contract";
import type {
  AgentManifestValidationResult,
  AgentPackage,
  AgentPackageAsset,
  AgentResolutionIssue,
} from "./agent-manifest.contract";
import {
  collectPackageIssues,
  createPackageIssue,
  hasBlockingPackageIssue,
} from "./agent-package-json-issues.contract";
import {
  buildPackageManifest,
  readAgentPackageFromRecord,
} from "./agent-package-json-readers.contract";

interface AgentPackageJsonParseResult extends AgentManifestValidationResult {
  package: AgentPackage | null;
}

type PackageJsonInputParseResult =
  | {
      issue: AgentResolutionIssue;
      ok: false;
    }
  | {
      ok: true;
      value: unknown;
    };

export function parseAgentPackageJson(input: string): AgentPackageJsonParseResult {
  const parsedInput = parsePackageJsonInput(input);

  if (!parsedInput.ok) {
    return {
      issues: [parsedInput.issue],
      manifest: null,
      package: null,
    };
  }

  const parsed = parsedInput.value;

  if (!isRecord(parsed)) {
    return invalidPackageResult("package.invalid", "Agent package manifest must be a JSON object.");
  }

  const issues = collectPackageIssues(parsed);

  if (hasBlockingPackageIssue(issues)) {
    return {
      issues,
      manifest: null,
      package: null,
    };
  }

  let manifest;

  try {
    manifest = buildPackageManifest(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent package manifest is invalid.";

    return invalidPackageResult("package.invalid", message, "unsupported");
  }

  if (manifest === null) {
    return {
      issues,
      manifest: null,
      package: null,
    };
  }

  return {
    issues,
    manifest,
    package: readAgentPackageFromRecord(parsed, manifest),
  };
}

export function attachAgentPackageAssets(
  agentPackage: AgentPackage,
  assets: AgentPackageAsset[],
): AgentPackage {
  return {
    ...agentPackage,
    assets,
  };
}

function parsePackageJsonInput(input: string): PackageJsonInputParseResult {
  try {
    const parsed: unknown = JSON.parse(input);
    return {
      ok: true,
      value: parsed,
    };
  } catch {
    return {
      issue: createPackageIssue(
        "package.json.invalid",
        "Agent package manifest must be valid JSON.",
      ),
      ok: false,
    };
  }
}

function invalidPackageResult(
  code: string,
  message: string,
  status?: "unsupported",
): AgentPackageJsonParseResult {
  return {
    issues: [createPackageIssue(code, message, status)],
    manifest: null,
    package: null,
  };
}
