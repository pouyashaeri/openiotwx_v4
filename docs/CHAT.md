# The planning chat

The chat asks the same questions as the step-by-step survey (`/wizard`), in the same order, then writes the same draft plan.

## One source of wording

The question titles, the line under each, the placeholders and the step names live in `src/lib/wizard/questions.ts`. The survey page and the chat both import them, and the choices (with their descriptions) come from `src/lib/wizard/catalog.ts`. Change a word there and both change. `scripts/e2e-chat.mjs` walks both in a browser and compares them.

## What the model does (and does not)

What to ask next is decided in code (`src/lib/chat/engine.ts`). A language model is only used when someone types free text. Its one job is to say which of the survey's own choices the words match, or that the message is really a request for help. Whatever it returns is checked against the survey's choice lists (`validateExtraction`), so it can only pick from those lists. Tapping a choice never calls the model.

With no model configured, or when it fails or a limit is reached, the chat uses keyword matching and keeps working. The dot on the avatar is green when a model is on and amber when the chat is using keywords.

## Turning the model on (server side)

The key stays on the server. The browser only talks to the app's own `/chat` server function, and never sees the key or the provider's address. Set ONE of:

| Variable | Meaning |
| --- | --- |
| `ANTHROPIC_API_KEY` | Use Claude. `CHAT_LLM_MODEL` names the model (default `claude-haiku-5-5`, small and fast). `ANTHROPIC_BASE_URL` overrides `https://api.anthropic.com`. |
| `CHAT_LLM_ENDPOINT` | Any server that speaks the OpenAI chat API (`https://.../v1`), such as one you run yourself. `CHAT_LLM_KEY` is sent as a bearer token if set. `CHAT_LLM_MODEL` names the model there (default `qwen2.5:3b`). |

Limits that keep a public chat from running up a bill: `CHAT_LLM_PER_10MIN` (default 30 messages per visitor) and `CHAT_LLM_DAILY_CAP` (default 3000 calls per server process).

## Problems and other topics

If a message is not an answer, because it reports a problem, asks for a person, or asks something the choices cannot answer, the chat offers to write to support instead of forcing it into a plan answer. The card opens `/contact` with the topic and the person's own words filled in, and shows the support email when one is set. The chat also always has a **Contact support** link. See [SUPPORT.md](SUPPORT.md) for the contact page, the email address and the admin inbox.

## Testing

- `npm test` includes the chat engine and selection tests.
- `node scripts/e2e-chat.mjs [baseUrl]` compares the survey and the chat and checks the support hand-off.
- Dev servers keep data in `.data/pglite` on port 8080 only. Start extra test servers with `PGLITE_DIR=memory` so they start clean.
