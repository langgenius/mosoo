import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

interface PackageMetadata {
  readonly version?: unknown;
}

describe("pinned Cloudflare Sandbox network contract", () => {
  test("keeps the 0.12.9 start-time and persisted interception semantics we enforce", async () => {
    const workspaceRequire = createRequire(import.meta.url);
    const sandboxPackagePath = workspaceRequire.resolve("@cloudflare/sandbox/package.json");
    const sandboxPackage = (await Bun.file(sandboxPackagePath).json()) as PackageMetadata;

    expect(sandboxPackage.version).toBe("0.12.9");

    const sandboxRequire = createRequire(sandboxPackagePath);
    const containersPackagePath = sandboxRequire.resolve("@cloudflare/containers/package.json");
    const containersPackage = (await Bun.file(containersPackagePath).json()) as PackageMetadata;

    // The live redirect/IP egress smoke covers this exact transitive release.
    // Pin it alongside Sandbox so the evidence cannot silently drift.
    expect(containersPackage.version).toBe("0.3.7");

    const containersEntryPath = sandboxRequire.resolve("@cloudflare/containers");
    const containerSource = await Bun.file(
      join(dirname(containersEntryPath), "lib/container.js"),
    ).text();

    // Limited relies on enableInternet being sampled for container start, not
    // retroactively applied to an already-running raw TCP stack.
    expect(containerSource).toContain(
      "const enableInternet = options?.enableInternet ?? this.enableInternet;",
    );
    // The containers base defaults HTTPS interception off, so Mosoo's
    // production assignment cannot rely on an SDK default.
    expect(containerSource).toContain("interceptHttps = false;");
    // The SDK runtime allowlist must persist across DO wakes and be re-applied
    // to a surviving container. Our own record separately restores the
    // start-time enableInternet decision.
    expect(containerSource).toContain("async setAllowedHosts(hosts)");
    expect(containerSource).toContain("this.ctx.storage.kv.put(OUTBOUND_CONFIGURATION_KEY");
    expect(containerSource).toContain("this.ctx.storage.kv.get(OUTBOUND_CONFIGURATION_KEY");
    expect(containerSource).toContain("this.container.interceptOutboundHttps('*', fetcher)");

    const sandboxEntryPath = sandboxRequire.resolve("@cloudflare/sandbox");
    const sandboxDistPath = dirname(sandboxEntryPath);
    const sandboxChunkName = (await readdir(sandboxDistPath)).find(
      (name) => name.startsWith("sandbox-") && name.endsWith(".js"),
    );

    expect(sandboxChunkName).toBeDefined();

    const sandboxSource = await Bun.file(join(sandboxDistPath, sandboxChunkName ?? "")).text();

    // The Sandbox layer passes the interception decision into the container so
    // the image trusts Cloudflare's injected CA for intercepted HTTPS.
    expect(sandboxSource).toContain("if (this.interceptHttps)");
    expect(sandboxSource).toContain('SANDBOX_INTERCEPT_HTTPS: "1"');
    // credentialProxy keeps the real R2 secret inside the Durable Object. The
    // container receives unusable x/x credentials and reaches only the SDK's
    // internal credential proxy host.
    expect(sandboxSource).toContain(
      'const S3_CREDENTIAL_PROXY_HOST = "s3-credential-proxy.internal"',
    );
    expect(sandboxSource).toContain('accessKeyId: "x"');
    expect(sandboxSource).toContain('secretAccessKey: "x"');
    expect(sandboxSource).toContain("credentialProxyEnabled = options.credentialProxy === true");
  });
});
