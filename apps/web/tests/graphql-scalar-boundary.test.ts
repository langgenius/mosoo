import { describe, expect, test } from "bun:test";

import codegenConfig from "../../../dev/config/graphql-codegen.ts";

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${label} to be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${label} to be a string.`);
  }

  return value;
}

describe("web GraphQL scalar boundary", () => {
  test("keeps codegen scalar mappings delegated to owner packages", () => {
    const config = requireRecord(codegenConfig.config, "GraphQL codegen config");
    const scalars = requireRecord(config["scalars"], "GraphQL scalar mappings");
    const ulid = requireRecord(scalars["ULID"], "ULID scalar mapping");
    const ulidInput = requireString(ulid["input"], "ULID scalar input mapping");
    const ulidOutput = requireString(ulid["output"], "ULID scalar output mapping");
    const primitiveRecord = requireString(
      scalars["PrimitiveRecord"],
      "PrimitiveRecord scalar mapping",
    );

    expect(ulidInput).toBe(ulidOutput);
    expect(ulidInput).toContain("#");
    expect(ulidInput).not.toBe("string");
    expect(primitiveRecord).toContain("#");
    expect(primitiveRecord).not.toBe("Record<string, unknown>");
  });
});
