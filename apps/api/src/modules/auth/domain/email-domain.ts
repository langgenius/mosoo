const PUBLIC_EMAIL_DOMAINS = new Set([
  "aol.com",
  "126.com",
  "163.com",
  "foxmail.com",
  "gmail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "msn.com",
  "outlook.com",
  "protonmail.com",
  "qq.com",
  "sina.com",
  "yahoo.com",
]);

export function getPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain.toLowerCase());
}
