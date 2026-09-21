import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureSandboxHttpsInterception } from "../src/adapters/durable-objects/sandbox-https-interception";

test("startup CA trusts multipart PUTs without disabling certificate or hostname checks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mosoo-backup-tls-"));
  const cert = join(directory, "cert.pem");
  const key = join(directory, "key.pem");
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    const certificate = Bun.spawn(
      [
        "openssl",
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost",
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    const certificateError = await new Response(certificate.stderr).text();
    if ((await certificate.exited) !== 0) throw new Error(certificateError);

    const receivedParts: number[] = [];
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      tls: { cert: Bun.file(cert), key: Bun.file(key) },
      async fetch(request) {
        expect(request.method).toBe("PUT");
        receivedParts.push((await request.arrayBuffer()).byteLength);
        return new Response(null, { headers: { etag: '"part"' } });
      },
    });
    const sandbox = { envVars: { SANDBOX_CA_CERT: cert }, interceptHttps: false };
    configureSandboxHttpsInterception(sandbox, true);
    const baseEnv = { ...process.env };
    delete baseEnv["NODE_EXTRA_CA_CERTS"];
    delete baseEnv["NODE_TLS_REJECT_UNAUTHORIZED"];
    const upload = async (startup: boolean, host = "localhost") => {
      const child = Bun.spawn(
        [
          process.execPath,
          "-e",
          `
        // The old SDK assigns this only after Bun has initialized its roots.
        process.env.NODE_EXTRA_CA_CERTS = process.env.SANDBOX_CA_CERT;
        try {
          const archive = new Blob([new Uint8Array(12 * 1024 * 1024)]);
          for (let part = 0; part < 2; part++) {
            const response = await fetch(process.env.TEST_BACKUP_URL, {
              method: "PUT", body: archive.slice(part * 6 * 1024 * 1024, (part + 1) * 6 * 1024 * 1024),
            });
            if (!response.ok || !response.headers.get("etag")) process.exit(2);
          }
        } catch { process.exit(1); }
      `,
        ],
        {
          env: {
            ...baseEnv,
            SANDBOX_CA_CERT: cert,
            ...(startup ? sandbox.envVars : {}),
            TEST_BACKUP_URL: `https://${host}:${server?.port}/part`,
          },
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      return child.exited;
    };
    expect(await upload(false)).toBe(1);
    expect(receivedParts).toEqual([]);
    expect(await upload(true)).toBe(0);
    expect(receivedParts).toEqual([6 * 1024 * 1024, 6 * 1024 * 1024]);
    expect(await upload(true, "127.0.0.1")).toBe(1);
    expect(receivedParts).toHaveLength(2);
  } finally {
    server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
