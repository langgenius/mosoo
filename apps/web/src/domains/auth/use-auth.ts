import { authClient } from "./api/auth-client";

export interface AuthUser {
  email: string;
  id: string;
  image?: string | null;
  name: string;
}

interface AuthState {
  loading: boolean;
  user: AuthUser | null;
}

function isAuthUser(value: unknown): value is AuthUser {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return (
    "email" in value &&
    typeof value.email === "string" &&
    "id" in value &&
    typeof value.id === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    (!("image" in value) ||
      value.image === undefined ||
      value.image === null ||
      typeof value.image === "string")
  );
}

export function useAuth(): AuthState {
  const session = authClient.useSession();
  const sessionUser = session.data?.user;

  return {
    loading: session.isPending,
    user: isAuthUser(sessionUser) ? sessionUser : null,
  };
}
