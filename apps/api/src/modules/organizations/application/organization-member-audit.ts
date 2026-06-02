export function memberResourceDisplay(input: {
  email: string | null;
  name: string | null;
}): string {
  return input.name ?? input.email ?? "Organization member";
}

export function membershipStatus(disabledAt: number | null): "active" | "disabled" {
  return disabledAt === null ? "active" : "disabled";
}
