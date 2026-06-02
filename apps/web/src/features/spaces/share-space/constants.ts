export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  edit: "Can edit",
  read: "Can view",
};

export const ROLE_ORDER = ["admin", "edit", "read"] as const;

export function getShareDialogErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error";
}
