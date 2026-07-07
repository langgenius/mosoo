import { describe, expect, test } from "bun:test";

import type { NativeValidateResult } from "@mosoo/contracts/native-deployment";
import {
  NATIVE_RUN_ERROR_CODES,
  parseNativeDeploymentRunResult,
  serializeNativeDeploymentRunResult,
} from "@mosoo/contracts/native-deployment-run";
import type { NativeDeploymentRunResult } from "@mosoo/contracts/native-deployment-run";

const GREEN_VALIDATE: NativeValidateResult = {
  facts: {
    agentCount: 2,
    agents: [
      { exposed: true, name: "support", source: "primary" },
      { exposed: false, name: "escalation", source: "named" },
    ],
    spec: "mosoo.spec.v1",
    web: { agent: "support", declared: true },
  },
  failures: [],
  schemaVersion: 1,
  valid: true,
};

const RED_VALIDATE: NativeValidateResult = {
  facts: null,
  failures: [
    {
      action: 'Set spec = "mosoo.spec.v1" in .mosoo.toml.',
      code: "native.toml.spec_missing",
      file: ".mosoo.toml",
      problem: "spec is required.",
      severity: "error",
    },
    {
      action: "Provide runtime in .agent/manifest.json.",
      code: "native.agent.manifest_invalid",
      field: "runtime",
      file: ".agent/manifest.json",
      problem: "runtime is required.",
      severity: "error",
    },
  ],
  schemaVersion: 1,
  valid: false,
};

const FULL_RESULT: NativeDeploymentRunResult = {
  facts: {
    agentCount: 2,
    agents: [
      { action: "created", exposed: true, name: "support", versionNumber: 1 },
      { action: "unchanged", exposed: false, name: "escalation" },
    ],
    specVersion: "mosoo.spec.v1",
    web: { agent: "support", declared: true },
  },
  validate: GREEN_VALIDATE,
};

const VALIDATE_ONLY_RESULT: NativeDeploymentRunResult = {
  facts: null,
  validate: RED_VALIDATE,
};

describe("native deployment run contract", () => {
  test("locks the closed run error code set", () => {
    expect([...NATIVE_RUN_ERROR_CODES]).toEqual([
      "native_agent_name_ambiguous",
      "native_provision_failed",
      "native_setup_required",
      "native_validation_failed",
      "native_web_static_unsupported",
    ]);
  });

  test("keeps the run error code set sorted and duplicate free", () => {
    const codes = [...NATIVE_RUN_ERROR_CODES];

    expect(codes).toEqual([...codes].toSorted());
    expect(new Set(codes).size).toBe(codes.length);
  });

  test("round-trips a full result with facts", () => {
    const json = serializeNativeDeploymentRunResult(FULL_RESULT);

    expect(parseNativeDeploymentRunResult(json)).toEqual(FULL_RESULT);
  });

  test("round-trips a validate-only result with null facts", () => {
    const json = serializeNativeDeploymentRunResult(VALIDATE_ONLY_RESULT);

    expect(parseNativeDeploymentRunResult(json)).toEqual(VALIDATE_ONLY_RESULT);
  });

  test("round-trip preserves omitted optional keys as absent", () => {
    const json = serializeNativeDeploymentRunResult(FULL_RESULT);
    const parsed = parseNativeDeploymentRunResult(json);

    expect(parsed).not.toBeNull();
    expect(Object.hasOwn(parsed?.facts?.agents[1] ?? {}, "versionNumber")).toBe(false);
    expect(Object.hasOwn(parsed?.validate.failures[0] ?? {}, "field")).toBe(false);
  });

  test("parses null column values to null", () => {
    expect(parseNativeDeploymentRunResult(null)).toBeNull();
  });

  test("returns null for malformed json", () => {
    expect(parseNativeDeploymentRunResult("")).toBeNull();
    expect(parseNativeDeploymentRunResult("not json")).toBeNull();
    expect(parseNativeDeploymentRunResult('{"facts":')).toBeNull();
    expect(parseNativeDeploymentRunResult("null")).toBeNull();
    expect(parseNativeDeploymentRunResult("[]")).toBeNull();
    expect(parseNativeDeploymentRunResult('"validate"')).toBeNull();
  });

  test("returns null for json that misses the contract shape", () => {
    const base = JSON.parse(serializeNativeDeploymentRunResult(FULL_RESULT)) as Record<
      string,
      unknown
    >;

    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => {
        delete value["validate"];
      },
      (value) => {
        (value["validate"] as Record<string, unknown>)["schemaVersion"] = 2;
      },
      (value) => {
        (value["validate"] as Record<string, unknown>)["valid"] = "yes";
      },
      (value) => {
        (value["validate"] as Record<string, unknown>)["failures"] = {};
      },
      (value) => {
        const facts = (value["validate"] as Record<string, unknown>)["facts"] as Record<
          string,
          unknown
        >;
        facts["spec"] = "mosoo.spec.v2";
      },
      (value) => {
        const facts = value["facts"] as Record<string, unknown>;
        (facts["agents"] as Record<string, unknown>[])[0]["action"] = "reticulated";
      },
      (value) => {
        const facts = value["facts"] as Record<string, unknown>;
        (facts["agents"] as Record<string, unknown>[])[0]["versionNumber"] = "1";
      },
      (value) => {
        const facts = value["facts"] as Record<string, unknown>;
        (facts["agents"] as Record<string, unknown>[])[1]["exposed"] = "false";
      },
      (value) => {
        const facts = value["facts"] as Record<string, unknown>;
        facts["web"] = { agent: 7, declared: true };
      },
      (value) => {
        const facts = value["facts"] as Record<string, unknown>;
        facts["web"] = { agent: "support" };
      },
      (value) => {
        value["facts"] = [];
      },
    ];

    for (const mutate of mutations) {
      const mutated = structuredClone(base);

      mutate(mutated);
      expect(parseNativeDeploymentRunResult(JSON.stringify(mutated))).toBeNull();
    }
  });

  test("returns null when a validate failure carries an unknown code", () => {
    const json = serializeNativeDeploymentRunResult(VALIDATE_ONLY_RESULT);
    const mutated = JSON.parse(json) as {
      validate: { failures: Array<Record<string, unknown>> };
    };

    mutated.validate.failures[0]["code"] = "native.toml.exploded";

    expect(parseNativeDeploymentRunResult(JSON.stringify(mutated))).toBeNull();
  });

  test("drops unknown keys instead of carrying them through", () => {
    const json = serializeNativeDeploymentRunResult(VALIDATE_ONLY_RESULT);
    const widened = JSON.parse(json) as Record<string, unknown>;

    widened["debug"] = { note: "not part of the contract" };
    (widened["validate"] as Record<string, unknown>)["extra"] = true;

    expect(parseNativeDeploymentRunResult(JSON.stringify(widened))).toEqual(VALIDATE_ONLY_RESULT);
  });
});
