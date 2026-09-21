export interface SandboxHttpsInterception {
  envVars: Record<string, string>;
  interceptHttps: boolean;
}

/**
 * Keeps the Cloudflare interception hook and Sandbox control-plane startup
 * flag aligned. Full network Sandboxes must keep interception off; otherwise
 * the control plane requires a CA that Cloudflare only injects after an
 * outbound interception rule is installed.
 */
export function configureSandboxHttpsInterception(
  sandbox: SandboxHttpsInterception,
  enabled: boolean,
): void {
  sandbox.interceptHttps = enabled;

  const envVars = { ...sandbox.envVars };
  if (enabled) {
    envVars["SANDBOX_INTERCEPT_HTTPS"] = "1";
    // Bun reads additional roots at process startup. The SDK installs the CA
    // later, which covers subprocess curl but not its own multipart fetches.
    envVars["NODE_EXTRA_CA_CERTS"] =
      envVars["SANDBOX_CA_CERT"] ?? "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
  } else {
    delete envVars["SANDBOX_INTERCEPT_HTTPS"];
    delete envVars["NODE_EXTRA_CA_CERTS"];
  }
  sandbox.envVars = envVars;
}
