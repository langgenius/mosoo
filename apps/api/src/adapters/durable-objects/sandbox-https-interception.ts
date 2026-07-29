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
  } else {
    delete envVars["SANDBOX_INTERCEPT_HTTPS"];
  }
  sandbox.envVars = envVars;
}
