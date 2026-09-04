import type { ReactElement } from "react";

type AuthDoodlesComponent = () => ReactElement | null;
type AuthDoodlesModule = { AuthDoodles: AuthDoodlesComponent };

function EmptyAuthDoodles(): null {
  return null;
}

export async function loadAuthDoodles(
  load: () => Promise<AuthDoodlesModule> = () => import("./auth-doodles"),
): Promise<{ default: AuthDoodlesComponent }> {
  try {
    const doodles = await load();
    return { default: doodles.AuthDoodles };
  } catch {
    // Decorative art must never take down the auth form.
    return { default: EmptyAuthDoodles };
  }
}
