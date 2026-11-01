import type { ChatConfig } from "./llm.ts";

/**
 * Where the language model lives. It is set when the site is built, by the site's owner, and is
 * never read from the visitor's browser or computer. Nothing here points at the visitor's own
 * machine, and no model runs on it.
 *
 *   VITE_CHAT_ENDPOINT  base URL of a server that speaks the OpenAI chat API (https://.../v1)
 *   VITE_CHAT_MODEL     the model name that server should use
 *
 * With no endpoint set, the chat uses plain keyword matching and makes no model requests at all.
 *
 * Do not put a secret key in a VITE_ variable: everything with that prefix is shipped to the
 * browser. Put the key on the server, or on a small proxy in front of it.
 */
const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

const endpoint = (env.VITE_CHAT_ENDPOINT ?? "").trim().replace(/\/+$/, "");

export const CHAT_CONFIG: ChatConfig | null = endpoint
  ? { endpoint, model: (env.VITE_CHAT_MODEL ?? "").trim() || "qwen2.5:3b" }
  : null;
