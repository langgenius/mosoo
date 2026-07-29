import type { ReactElement } from "react";

type LoginDoodlesComponent = () => ReactElement | null;
type LoginDoodlesModule = { LoginDoodles: LoginDoodlesComponent };

function EmptyLoginDoodles(): null {
  return null;
}

export async function loadLoginDoodles(
  load: () => Promise<LoginDoodlesModule> = () => import("./doodles"),
): Promise<{ default: LoginDoodlesComponent }> {
  try {
    const doodles = await load();
    return { default: doodles.LoginDoodles };
  } catch {
    // Decorative art must never take down the login form.
    return { default: EmptyLoginDoodles };
  }
}
