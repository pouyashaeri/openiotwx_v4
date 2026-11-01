import { createMiddleware } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";

/** Signed-in, not suspended; context gains the caller's `profile` (with role). */
export const appUserMiddleware = createMiddleware({ type: "function" })
  .middleware([authMiddleware])
  .server(async ({ next, context }) => {
    const { ensureProfile } = await import("./service.server");
    const profile = await ensureProfile(context.userId);
    if (profile.suspended) throw new Error("This account is suspended. Contact an administrator.");
    return next({ context: { profile } });
  });

/** Same as `appUserMiddleware`, but only admins get through. */
export const adminMiddleware = createMiddleware({ type: "function" })
  .middleware([appUserMiddleware])
  .server(async ({ next, context }) => {
    if (context.profile.role === "user") throw new Error("Not found");
    return next();
  });
