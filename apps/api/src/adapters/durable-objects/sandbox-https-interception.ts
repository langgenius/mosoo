interface SandboxHttpsInterception {
  interceptHttps: boolean;
}

/**
 * Pins the HTTPS interception choice instead of inheriting the SDK default.
 * Local Sandbox keeps the existing CA compatibility escape hatch; production
 * must intercept HTTPS or a Limited allowlist would cover only plain HTTP.
 */
export function configureSandboxHttpsInterception(
  sandbox: SandboxHttpsInterception,
  localBinding: string | undefined,
): void {
  // Local workerd can omit the ephemeral CA while HTTPS interception is active,
  // resetting TLS before the sandbox reaches providers.
  // With interception off the egress allowlist cannot cover HTTPS, so limited
  // network policies fail closed while this is in effect (sandbox-network-enforcement.ts).
  sandbox.interceptHttps = localBinding !== "true";
}
