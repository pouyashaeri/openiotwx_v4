import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { adminMiddleware } from "@/lib/platform/middleware";
import { LIMITS } from "./info";

/** The address shown on /contact. Public: it is meant to be seen. Null when none is set. */
export const supportInfo = createServerFn({ method: "GET" }).handler(async () => {
  const { getSupportAddress } = await import("./support.server");
  return { email: (await getSupportAddress()).email };
});

/** Anyone may write to support, signed in or not. The server validates, rate-limits and ignores robots. */
export const sendSupport = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().max(LIMITS.name * 2),
      email: z.string().max(LIMITS.email * 2),
      topic: z.string().max(40),
      message: z.string().max(LIMITS.messageMax * 2),
      page: z.string().max(LIMITS.page * 2).optional(),
      // A hidden field. Only a robot fills it in.
      website: z.string().max(200).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { submitMessage } = await import("./support.server");
    // Link the message to the account when the sender is signed in; never require it.
    let userId: string | null = null;
    try {
      const { getSessionUser } = await import("@/lib/auth/verify.server");
      userId = (await getSessionUser().catch(() => null))?.id ?? null;
    } catch {
      userId = null;
    }
    const r = await submitMessage(data, userId);
    return { ok: r.ok, emailed: r.emailed };
  });

// ── admin console ───────────────────────────────────────────────────────────

export const supportAdminList = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async () => (await import("./support.server")).listMessages());

export const supportAdminSetStatus = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(z.object({ id: z.string().uuid(), status: z.enum(["new", "handled"]) }))
  .handler(async ({ context, data }) => {
    await (await import("./support.server")).setStatus(context.profile.userId, data.id, data.status);
  });

export const supportAdminDelete = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    await (await import("./support.server")).deleteMessage(context.profile.userId, data.id);
  });

/** An empty string clears the admin setting, so SUPPORT_EMAIL (if set) applies again. */
export const supportAdminSaveEmail = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(z.object({ email: z.string().trim().max(LIMITS.email) }))
  .handler(async ({ context, data }) => (await import("./support.server")).saveSupportEmail(context.profile.userId, data.email));
