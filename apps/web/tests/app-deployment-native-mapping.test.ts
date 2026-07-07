import { describe, expect, test } from "bun:test";

import { toNativeRunResult } from "../src/domains/app/api/app-deployment-client";

/**
 * The GraphQL layer delivers explicit `null`s where the contract omits
 * optional keys; `toNativeRunResult` must rebuild the canonical omitted-key
 * shape and keep the strict parser's closed-set semantics.
 */

type RawNativeRunResult = NonNullable<Parameters<typeof toNativeRunResult>[0]>;

function rawResult(): RawNativeRunResult {
  return {
    facts: {
      agentCount: 2,
      agents: [
        { action: "created", exposed: true, name: "quiz-master", versionNumber: 1 },
        { action: "unchanged", exposed: false, name: "triage-helper", versionNumber: null },
      ],
      specVersion: "mosoo.spec.v1",
      web: { agent: null, declared: false },
    },
    validate: {
      facts: {
        agentCount: 2,
        agents: [{ exposed: true, name: "quiz-master", source: "named" }],
        spec: "mosoo.spec.v1",
        web: { agent: "quiz-master", declared: true },
      },
      failures: [
        {
          action: "add OPENAI_API_KEY in Console → Environment",
          code: "native.setup.environment_secret",
          field: null,
          file: ".agent/environment/definition.json",
          problem: "secret is declared but has no value on this instance",
          severity: "setup_required",
        },
      ],
      schemaVersion: 1,
      valid: true,
    },
  };
}

describe("toNativeRunResult", () => {
  test("passes null through for legacy runs", () => {
    expect(toNativeRunResult(null)).toBeNull();
  });

  test("converts GraphQL explicit nulls into omitted contract keys", () => {
    const result = toNativeRunResult(rawResult());

    expect(result).not.toBeNull();
    expect(result?.validate.valid).toBe(true);
    expect(result?.facts?.agentCount).toBe(2);

    // versionNumber: null becomes an ABSENT key, not an undefined value.
    const unversioned = result?.facts?.agents[1];
    expect(unversioned?.name).toBe("triage-helper");
    expect(unversioned !== undefined && "versionNumber" in unversioned).toBe(false);

    // A real version number survives the round trip.
    expect(result?.facts?.agents[0]?.versionNumber).toBe(1);

    // web.agent: null is dropped; a present agent name is preserved.
    const factsWeb = result?.facts?.web;
    expect(factsWeb !== undefined && "agent" in factsWeb).toBe(false);
    expect(result?.validate.facts?.web.agent).toBe("quiz-master");

    // failure.field: null is dropped from the contract failure.
    const failure = result?.validate.failures[0];
    expect(failure?.code).toBe("native.setup.environment_secret");
    expect(failure !== undefined && "field" in failure).toBe(false);
  });

  test("rejects unknown failure codes like a corrupted row", () => {
    const raw = rawResult();
    raw.validate.failures = [
      {
        action: "noop",
        code: "native.bogus.code",
        field: null,
        file: ".mosoo.toml",
        problem: "made-up code the closed set does not know",
        severity: "error",
      },
    ];

    expect(toNativeRunResult(raw)).toBeNull();
  });
});
