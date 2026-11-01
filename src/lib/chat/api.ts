import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** Is a language model configured on the server? The browser never sees the key or the provider's address. */
export const chatLlmStatus = createServerFn({ method: "GET" }).handler(async () => (await import("./interpret.server")).status());

/**
 * One free-text chat answer, read by the model. Open to everyone (the chat works signed out), so the
 * server limits how often one visitor can ask. The result is raw and is validated by the chat engine.
 */
export const chatInterpret = createServerFn({ method: "POST" })
  .validator(z.object({ field: z.string().max(20).nullable(), message: z.string().min(1).max(1000) }))
  .handler(async ({ data }) => {
    const r = await (await import("./interpret.server")).interpret(data.field, data.message);
    // Plain JSON only: the model's object is passed as text.
    return { raw: r.raw === null ? null : JSON.stringify(r.raw), reason: r.reason ?? null };
  });
