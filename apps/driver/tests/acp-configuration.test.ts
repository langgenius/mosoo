import { describe, expect, test } from "bun:test";

import {
  ACP_PROTOCOL_VERSION,
  enforceAcpProtocolVersion,
  resolveAcpAuthMethodId,
} from "../src/runtimes/acp/acp-configuration";
import type { AcpInitializeResult } from "../src/runtimes/acp/acp-types";

function createInitializeResult(protocolVersion: number | string | null): AcpInitializeResult {
  return {
    agentCapabilities: {},
    agentInfo: null,
    authMethods: [],
    protocolVersion,
  };
}

describe("ACP runtime configuration", () => {
  test("accepts the configured ACP protocol version only", () => {
    expect(() =>
      enforceAcpProtocolVersion(createInitializeResult(ACP_PROTOCOL_VERSION)),
    ).not.toThrow();
    expect(() =>
      enforceAcpProtocolVersion(createInitializeResult(String(ACP_PROTOCOL_VERSION))),
    ).not.toThrow();

    expect(() => enforceAcpProtocolVersion(createInitializeResult(2))).toThrow();
    expect(() => enforceAcpProtocolVersion(createInitializeResult(null))).toThrow();
  });

  test("fails fast when a configured auth method is not advertised", () => {
    expect(
      resolveAcpAuthMethodId([{ id: "browser-login", name: "Browser Login" }], {
        MOSOO_ACP_AUTH_METHOD_ID: "browser-login",
      }),
    ).toBe("browser-login");

    expect(resolveAcpAuthMethodId([{ id: "browser-login", name: "Browser Login" }], {})).toBeNull();

    expect(() =>
      resolveAcpAuthMethodId([{ id: "browser-login", name: "Browser Login" }], {
        MOSOO_ACP_AUTH_METHOD_ID: "device-login",
      }),
    ).toThrow();
  });
});
