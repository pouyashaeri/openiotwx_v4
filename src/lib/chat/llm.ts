import type { Extractor } from "./engine.ts";
import { FIELD_BY_KEY, FIELDS, type FieldKey } from "./spec.ts";

/**
 * Talks to any OpenAI-compatible chat endpoint on a server the site's owner runs. The address is
 * fixed at build time (see config.ts). Nothing here runs a model in the visitor's browser or on
 * their device, and nothing is specific to one model or vendor.
 */

export type ChatConfig = {
  /** Base URL that serves /chat/completions and /models, with no trailing slash. */
  endpoint: string;
  model: string;
};

const PROMPT_FIELDS: FieldKey[] = FIELDS.filter((field) => field.key !== "siteName").map(
  (field) => field.key,
);

export function buildSystemPrompt(currentKey: FieldKey | null): string {
  const lines = PROMPT_FIELDS.map((key) => {
    const field = FIELD_BY_KEY[key];
    if (key === "count") {
      return "count: the number of stations as a number. One station is 1, a handful is 3, a small network is 6.";
    }
    const kind = field.kind === "multi" ? "a list of ids" : "one id";
    const choices = field.options.map((option) => `${option.id} = ${option.title}`).join("; ");
    return `${key} (${kind}): ${choices}`;
  });
  return [
    "You read what a person says while planning a small weather and environment station, and match it to fixed choices.",
    "Reply with ONLY a JSON object, no other text. Use only the ids listed below and never invent one.",
    "Leave out any field the person did not clearly state. If nothing matches, reply with {}.",
    "",
    ...lines,
    "sharp: true only if they say temperatures swing hard or get extremely hot or cold.",
    'exclude (list of ids, optional): for a list question, when the person says "all of them except ..." or "but not ...", put the ids to leave out here and keep them out of the list itself.',
    "",
    currentKey
      ? `The person was just asked about "${currentKey}". They may also mention other fields; include those as well.`
      : "The person has answered everything. Only include a field if they are correcting an earlier answer.",
    'Example reply: {"place":"farm","power":"solar","measures":["rain","soil"]}',
  ].join("\n");
}

function headers(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

/** Pull a JSON object out of a model reply, tolerating code fences and stray words around it. */
export function parseJsonReply(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export type Probe = { ok: boolean; models: string[]; error?: string };

/** Is a model server answering at this address? Fast, so the panel can show its status. */
export async function probe(config: ChatConfig): Promise<Probe> {
  try {
    const response = await fetchWithTimeout(
      `${config.endpoint}/models`,
      { headers: headers() },
      2500,
    );
    if (!response.ok)
      return { ok: false, models: [], error: `The server answered ${response.status}.` };
    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    return { ok: true, models: (body.data ?? []).map((m) => m.id ?? "").filter(Boolean) };
  } catch {
    return { ok: false, models: [], error: "No model server answered at that address." };
  }
}

/**
 * Builds the function the chat engine uses to read a message with the model.
 * `onFail` fires when the server cannot be reached, so the panel can switch to simple matching
 * and stop waiting on a server that is not there.
 */
export function createExtractor(config: ChatConfig, onFail?: (reason: string) => void): Extractor {
  return async ({ current, message }) => {
    try {
      // The first request can take a while: local servers load the model into memory on demand.
      const response = await fetchWithTimeout(
        `${config.endpoint}/chat/completions`,
        {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            model: config.model,
            temperature: 0,
            max_tokens: 200,
            stream: false,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: buildSystemPrompt(current?.key ?? null) },
              { role: "user", content: message },
            ],
          }),
        },
        60_000,
      );
      if (!response.ok) {
        onFail?.(
          response.status === 404
            ? `The server does not have the model "${config.model}".`
            : `The server answered ${response.status}.`,
        );
        return null;
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return parseJsonReply(body.choices?.[0]?.message?.content ?? "");
    } catch {
      onFail?.("No model server answered.");
      return null;
    }
  };
}
