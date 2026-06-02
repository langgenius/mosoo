import { describe, expect, test } from "bun:test";

import { OPENAI_DEFAULT_MODEL_ID } from "@mosoo/contracts/models";

import { parseProbeOptions } from "../bin/openai-local-runtime-probe-options";
import {
  DEFAULT_EXECUTABLE,
  LOCAL_RUNTIME_EXECUTABLE_ENV,
} from "../bin/openai-local-runtime-probe-types";

describe("OpenAI local runtime probe options", () => {
  test("uses the documented defaults", () => {
    const options = parseProbeOptions({
      args: [],
      cwd: "/workspace/project",
      env: {},
    });

    expect(options).toMatchObject({
      commandTimeoutMs: 120_000,
      cwd: "/workspace/project",
      executable: DEFAULT_EXECUTABLE,
      keepHome: false,
      model: OPENAI_DEFAULT_MODEL_ID,
      prompt: "Reply with exactly: ok",
      requestTimeoutMs: 60_000,
      showStderr: false,
      threadOnly: false,
    });
  });

  test("reads explicit environment and flag overrides", () => {
    const options = parseProbeOptions({
      args: ["--thread-only"],
      cwd: "/workspace/project",
      env: {
        [LOCAL_RUNTIME_EXECUTABLE_ENV]: "/usr/local/bin/openai-runtime",
        LOCAL_RUNTIME_COMMAND_TIMEOUT_MS: "2500",
        LOCAL_RUNTIME_CWD: "/workspace/runtime",
        LOCAL_RUNTIME_KEEP_HOME: "1",
        LOCAL_RUNTIME_PROMPT: "Say ready.",
        LOCAL_RUNTIME_REQUEST_TIMEOUT_MS: "1500",
        LOCAL_RUNTIME_SHOW_STDERR: "1",
        OPENAI_MODEL: "gpt-test",
      },
    });

    expect(options).toMatchObject({
      commandTimeoutMs: 2_500,
      cwd: "/workspace/runtime",
      executable: "/usr/local/bin/openai-runtime",
      keepHome: true,
      model: "gpt-test",
      prompt: "Say ready.",
      requestTimeoutMs: 1_500,
      showStderr: true,
      threadOnly: true,
    });
  });

  test("rejects unsupported flags", () => {
    expect(() =>
      parseProbeOptions({
        args: ["--thread"],
        cwd: "/workspace/project",
        env: {},
      }),
    ).toThrow("Unsupported flag: --thread.");
  });

  test("rejects lossy numeric and boolean options", () => {
    expect(() =>
      parseProbeOptions({
        args: [],
        cwd: "/workspace/project",
        env: {
          LOCAL_RUNTIME_REQUEST_TIMEOUT_MS: "1.5",
        },
      }),
    ).toThrow("positive integer");

    expect(() =>
      parseProbeOptions({
        args: [],
        cwd: "/workspace/project",
        env: {
          LOCAL_RUNTIME_KEEP_HOME: "true",
        },
      }),
    ).toThrow("Expected LOCAL_RUNTIME_KEEP_HOME to be 0 or 1");
  });
});
