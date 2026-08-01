import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  APP_DEPLOYMENT_SECRET_EXAMPLE_NAME,
  deleteAppDeploymentSecretCommand,
  listAppDeploymentSecretsCommand,
  setAppDeploymentSecretCommand,
} from "../src/routes/app-overview/deploy/components/deployment-secret-commands";

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("deployment secrets CLI surface", () => {
  test("uses generated mosoo console commands for list, set, and delete", () => {
    expect(listAppDeploymentSecretsCommand("01JAPP00000000000000000000")).toBe(
      "mosoo console apps app-deployment-secret-list --app-id 01JAPP00000000000000000000",
    );
    const setCommand = setAppDeploymentSecretCommand(
      "01JAPP00000000000000000000",
      "THIRD_PARTY_KEY",
    );
    expect(setCommand).toStartWith("(\n");
    expect(setCommand).toContain('secret_file="$(mktemp)"');
    expect(setCommand).toContain("trap 'rm -f \"$secret_file\"' EXIT");
    expect(setCommand).toContain('"appId": "01JAPP00000000000000000000"');
    expect(setCommand).toContain('"name": "THIRD_PARTY_KEY"');
    expect(setCommand).toContain('"value": "<secret-value>"');
    expect(setCommand).toContain(
      'mosoo console apps set-app-deployment-secret --file "$secret_file" -o json',
    );
    expect(setCommand).toEndWith("\n)");
    expect(setCommand).not.toContain("--input-value");
    expect(deleteAppDeploymentSecretCommand("01JAPP00000000000000000000", "THIRD_PARTY_KEY")).toBe(
      "mosoo console apps delete-app-deployment-secret --input-app-id 01JAPP00000000000000000000 --input-name THIRD_PARTY_KEY",
    );
    expect(APP_DEPLOYMENT_SECRET_EXAMPLE_NAME).toBe("MOSOO_API_TOKEN");
  });

  test("deploy secrets UI keeps a terminal alternative alongside the write-only form", () => {
    const source = readSource(
      "../src/routes/app-overview/deploy/components/deployment-secrets.tsx",
    );

    expect(source).toContain("Manage App secrets from your terminal");
    expect(source).toContain("listAppDeploymentSecretsCommand");
    expect(source).toContain("setAppDeploymentSecretCommand");
    expect(source).toContain("deleteAppDeploymentSecretCommand");
    expect(source).toContain("use a JSON body file");
    expect(source).toContain("multiline");
  });
});
